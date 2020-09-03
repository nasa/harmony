import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { get as getIn } from 'lodash';

import logger from '../../util/log';
import { NotFoundError } from '../../util/errors';
import { isMimeTypeAccepted } from '../../util/content-negotiation';
import { CmrCollection } from '../../util/cmr';
import { listToText } from '../../util/string';
import ArgoService from './argo-service';
import AsynchronizerService from './asynchronizer-service';
import HttpService from './http-service';
import MessageQueueService from './message-queue-service';
import NoOpService from './no-op-service';
import DataOperation from '../data-operation';
import BaseService, { ServiceConfig } from './base-service';
import RequestContext from '../request-context';
import env from '../../util/env';

let serviceConfigs = null;

/**
 * Loads the services configuration file.
 *
 * @returns {void}
 */
function loadServiceConfigs(): void {
  // Setup a type, !Env, that when placed in front of a string resolves substrings like
  // "${some_env_var}" to the corresponding environment variable
  const regex = /\$\{(\w+)\}/g;
  const EnvType = new yaml.Type('!Env', {
    kind: 'scalar',
    resolve: (data): boolean => data,
    construct: (data): string => data.replace(regex, (v) => process.env[v.match(/\w+/)] || ''),
  });

  // Load the config
  const buffer = fs.readFileSync(path.join(__dirname, '../../../config/services.yml'));
  const schema = yaml.Schema.create([EnvType]);
  const envConfigs = yaml.load(buffer.toString(), { schema });
  serviceConfigs = envConfigs[env.cmrEndpoint].filter((config) => config.enabled !== false && config.enabled !== 'false');
}

/**
 * Logs a warning if the configuration is considered invalid.
 * @param config The service configuration to validate
 */
function validateServiceConfig(config: ServiceConfig<unknown>): void {
  const value = config.maximum_async_granules || 0;
  if (value > env.maxGranuleLimit) {
    logger.warn(`Service ${config.name} attempting to allow more than the max allowed granules in a request. `
      + `Configured to use ${config.maximum_async_granules}, but will be limited to ${env.maxGranuleLimit}`);
  }
}

// Load config at require-time to ensure presence / validity early
loadServiceConfigs();
serviceConfigs.map(validateServiceConfig);

const serviceTypesToServiceClasses = {
  http: HttpService,
  queue: MessageQueueService,
  argo: ArgoService,
  noOp: NoOpService,
};

/**
 * Given a service configuration from services.yml and an operation, returns a
 * Service object for invoking that operation using the given service
 * @param {ServiceConfig} serviceConfig The configuration from services.yml
 * @param {DataOperation} operation The operation to perform
 * @returns {Service} An appropriate service for the given config
 * @throws {NotFoundError} If no appropriate service can be found
 */
export function buildService(
  serviceConfig: ServiceConfig<unknown>,
  operation: DataOperation,
): BaseService<unknown> {
  const ServiceClass = serviceTypesToServiceClasses[serviceConfig.type.name];
  if (!ServiceClass) {
    throw new NotFoundError(`Could not find an appropriate service class for type "${serviceConfig.type}"`);
  }

  if (serviceConfig.type.synchronous_only || serviceConfig.type.single_granule_requests) {
    return new AsynchronizerService(ServiceClass, serviceConfig, operation);
  }
  return new ServiceClass(serviceConfig, operation);
}

/**
 * Returns true if all of the collections in the given operation can be operated on by
 * the given service.
 *
 * @param {DataOperation} operation The operation to match
 * @param {ServiceConfig} serviceConfig A configuration for a single service from services.yml
 * @returns {boolean} true if all collections in the operation are compatible with the service
 */
function isCollectionMatch(
  operation: DataOperation,
  serviceConfig: ServiceConfig<unknown>,
): boolean {
  return operation.sources.every((source) => serviceConfig.collections.includes(source.collection));
}

/**
 * Returns the services that can be used based on the requested format
 * @param {String} format Additional context that's not part of the operation, but influences the
 *    choice regarding the service to use
 * @param {Array<Object>} configs The configuration to use for finding the operation, with all
 *    variables resolved (default: the contents of config/services.yml)
 * @returns {Object} An object with two properties - service and format for the service and format
 * that should be used to fulfill the given request context
 * @private
 */
function selectServicesForFormat(
  format: string, configs: ServiceConfig<unknown>[],
): ServiceConfig<unknown>[] {
  return configs.filter((config) => {
    const supportedFormats = getIn(config, 'capabilities.output_formats', []);
    return supportedFormats.find((f) => isMimeTypeAccepted(f, format));
  });
}

/**
 * Returns the format to use based on the operation, request context, and service configs
 * @param {DataOperation} operation The operation to perform.
 * @param {RequestContext} context Additional context that's not part of the operation, but
 *     influences the choice regarding the service to use
 * @param {Array<Object>} configs All service configurations that have matched up to this call
 * @returns {String} The output format to use
 * @private
 */
function selectFormat(
  operation: DataOperation, context: RequestContext, configs: ServiceConfig<unknown>[],
): string {
  let { outputFormat } = operation;
  if (!outputFormat && context.requestedMimeTypes && context.requestedMimeTypes.length > 0) {
    for (const mimeType of context.requestedMimeTypes) {
      const services = selectServicesForFormat(mimeType, configs);
      // Any of the provided services will work for the mimetype, but we only need to
      // check the first service to determine which format matches that. This is needed
      // to match a wildcard mime-type like */* or image/* to a format to request on the
      // backend service.
      if (services && services.length > 0) {
        const supportedFormats = getIn(services[0], 'capabilities.output_formats', []);
        outputFormat = supportedFormats.find((f) => isMimeTypeAccepted(f, mimeType));
      }
      if (outputFormat) break;
    }
  }
  return outputFormat;
}

/**
 * Returns true if the operation requires variable subsetting
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @returns {Boolean} true if the provided operation requires variable subsetting
 * @private
 */
function requiresVariableSubsetting(operation: DataOperation): boolean {
  const varSources = operation.sources.filter((s) => s.variables && s.variables.length > 0);
  return varSources.length > 0;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param {Array<Object>} configs The potential matching service configurations
 * @returns {Array<Object>} Any configurations that support variable subsetting
 * @private
 */
function supportsVariableSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.variable', false));
}

const noOpService: ServiceConfig<void> = {
  name: 'noOpService',
  type: { name: 'noOp' },
  capabilities: { output_formats: ['application/json'] },
};

class UnsupportedOperation extends Error { }

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @param {RequestContext} context Additional context that's not part of the operation, but
 *     influences the choice regarding the service to use
 * @param {Array<Object>} configs All service configurations that have matched up to this call
 * @returns {Array<Object>} Any service configurations that support the provided collection
 * @private
 */
function filterCollectionMatches(
  operation: DataOperation, context: RequestContext, configs: ServiceConfig<unknown>[],
): ServiceConfig<unknown>[] {
  const matches = configs.filter((config) => isCollectionMatch(operation, config));
  if (matches.length === 0) {
    throw new UnsupportedOperation('no services are configured for the collection');
  }
  return matches;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @param {RequestContext} context Additional context that's not part of the operation, but
 *     influences the choice regarding the service to use
 * @param {Array<Object>} configs All service configurations that have matched up to this call
 * @returns {Array<Object>} Any service configurations that support this operation based on variable
 * subsetting constraints
 * @private
 */
function filterVariableSubsettingMatches(
  operation: DataOperation, context: RequestContext, configs: ServiceConfig<unknown>[],
): ServiceConfig<unknown>[] {
  const variableSubsettingNeeded = requiresVariableSubsetting(operation);
  const matches = variableSubsettingNeeded ? supportsVariableSubsetting(configs) : configs;
  if (matches.length === 0) {
    throw new UnsupportedOperation('none of the services configured for the collection support variable subsetting');
  }
  return matches;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @param {RequestContext} context Additional context that's not part of the operation, but
 *     influences the choice regarding the service to use
 * @param {Array<Object>} configs All service configurations that have matched up to this call
 * @returns {Array<Object>} Any service configurations that support the requested output format
 * @private
 */
function filterOutputFormatMatches(
  operation: DataOperation, context: RequestContext, configs: ServiceConfig<unknown>[],
): ServiceConfig<unknown>[] {
  // If the user requested a certain output format
  let services = [];
  if (operation.outputFormat
    || (context && context.requestedMimeTypes && context.requestedMimeTypes.length > 0)) {
    const outputFormat = selectFormat(operation, context, configs);
    if (outputFormat) {
      // eslint-disable-next-line no-param-reassign
      operation.outputFormat = outputFormat;
      services = selectServicesForFormat(outputFormat, configs);
    }
  } else {
    services = configs;
  }

  if (services.length === 0) {
    throw new UnsupportedOperation('none of the services configured for the collection support '
      + 'reformatting to any of the requested formats '
      + `[${operation.outputFormat || context.requestedMimeTypes}]`);
  }
  return services;
}

const unsupportedOperationMessage = 'no services support the requested operation';

/**
 * For certain UnsupportedOperation errors the root cause will be a combination of multiple
 * request parameters such as requesting variable subsetting and a specific output format.
 * This function will return a detailed message on what combination was unsupported.
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @param {RequestContext} context Additional context that's not part of the operation, but
 *     influences the choice regarding the service to use
 * @returns {String} the reason the operation was not supported
 */
function unsupportedCombinationMessage(
  operation: DataOperation,
  context: RequestContext,
): string {
  const collections = operation.sources.map((s) => s.collection);
  let formats = operation.outputFormat ? [operation.outputFormat] : context.requestedMimeTypes;
  // Requests for mime-type * or */* are not requesting reformatting
  formats = formats?.filter((f) => f !== '*' && f !== '*/*');
  const variableSubset = requiresVariableSubsetting(operation);
  let message = `${unsupportedOperationMessage} for collection ${listToText(collections)}`;
  const requestedOptions = [];
  if (variableSubset) {
    requestedOptions.push('variable subsetting');
  }
  if (formats?.length > 0) {
    requestedOptions.push(`reformatting to ${listToText(formats)}`);
  }
  if (requestedOptions.length > 0) {
    message += `. Requested the following capabiliities: ${listToText(requestedOptions)}`;
  }
  return message;
}

// List of filter functions to call to identify the services that can support an operation.
// The functions will be chained in the specified order passing in the list of services
// that would work for each into the next filter function in the chain.
// All filter functions need to accept three arguments:
// 'operation' DataOperation The operation to perform.
// 'context' RequestContext request specific context that is not part of the operation model.
// 'configs' Array<Object> configs All service configurations that have matched so far.
const operationFilterFns = [
  filterCollectionMatches,
  filterVariableSubsettingMatches,
  filterOutputFormatMatches,
];

/**
 * Returns true if the collectionId has available backends
 *
 * @param {CmrCollection} collection The CMR collection to check
 * @returns {boolean} true if the collection has available backends, false otherwise
 */
export function isCollectionSupported(collection: CmrCollection): boolean {
  return serviceConfigs.find((sc) => sc.collections.includes(collection.id)) !== undefined;
}

/**
 * Returns the service configuration to use for the given data operation and request context
 * @param operation The operation to perform. Note that this function may mutate the operation.
 * @param context Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs The configuration to use for finding the operation, with all variables
 *     resolved (default: the contents of config/services.yml)
 * @returns the service configuration to use
 */
export function chooseServiceConfig(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[] = serviceConfigs,
): ServiceConfig<unknown> {
  let serviceConfig;
  let matches = configs;
  try {
    for (const filterFn of operationFilterFns) {
      matches = filterFn(operation, context, matches);
    }
    serviceConfig = matches[0];
  } catch (e) {
    if (e instanceof UnsupportedOperation) {
      logger.info(`Returning download links because ${e.message}.`);
      noOpService.message = unsupportedCombinationMessage(operation, context);
      serviceConfig = noOpService;
    } else {
      throw e;
    }
  }
  return serviceConfig;
}
