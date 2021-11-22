import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import _, { get as getIn } from 'lodash';

import logger from '../../util/log';
import { NotFoundError } from '../../util/errors';
import { isMimeTypeAccepted, allowsAny } from '../../util/content-negotiation';
import { CmrCollection } from '../../util/cmr';
import { listToText, Conjunction, isInteger } from '../../util/string';
import ArgoService from './argo-service';
import HttpService from './http-service';
import NoOpService from './no-op-service';
import DataOperation from '../data-operation';
import BaseService, { ServiceConfig } from './base-service';
import RequestContext from '../request-context';
import env from '../../util/env';

let serviceConfigs: ServiceConfig<unknown>[] = null;

/**
 * Converts the !Env directive in services.yml to either a string or a number
 * @param envDirective - The !Env directive
 */
function parseEnvironmentDirective(envDirective: string): string | number {
  const regex = /\$\{(\w+)\}/g;
  const strValue: string | number = envDirective.replace(regex, (v) => {
    const parameter = _.camelCase(v);
    return env[parameter.match(/\w+/) as unknown as string]
      || process.env[v.match(/\w+/) as unknown as string]
      || '';
  });

  if (isInteger(strValue)) {
    return parseInt(strValue, 10);
  }
  return strValue;
}

/**
 * Loads the services configuration file.
 */
function loadServiceConfigs(): void {
  // Setup a type, !Env, that when placed in front of a string resolves substrings like
  // "${some_env_var}" to the corresponding environment variable
  const EnvType = new yaml.Type('!Env', {
    kind: 'scalar',
    resolve: (data): boolean => data,
    construct: (data): string | number => parseEnvironmentDirective(data),
  });

  // Load the config - either from an env var or failing that from the services.yml file.
  // This allows us to use a configmap in k8s instead of reading the file system.
  const buffer = env.servicesYml ? Buffer.from(env.servicesYml, 'base64')
    : fs.readFileSync(path.join(__dirname, '../../../config/services.yml'));
  const schema = yaml.DEFAULT_SCHEMA.extend([EnvType]);
  const envConfigs = yaml.load(buffer.toString(), { schema });
  serviceConfigs = envConfigs[env.cmrEndpoint]
    .filter((config) => config.enabled !== false && config.enabled !== 'false');
}

/**
 * Throws an error if the configuration is invalid. Logs a warning if configuration will be ignored.
 * @param config - The service configuration to validate
 */
function validateServiceConfig(config: ServiceConfig<unknown>): void {
  const batchSize = config.batch_size;
  if (batchSize !== undefined) {
    if (!_.isInteger(batchSize)) {
      throw new TypeError(`Invalid batch_size ${batchSize}. Batch size must be an integer greater than or equal to 1.`);
    }
    if (batchSize <= 0) {
      throw new TypeError(`Invalid batch_size ${batchSize}. Batch size must be greater than or equal to 1.`);
    }
    if (batchSize > env.maxGranuleLimit) {
      logger.warn(`Service ${config.name} attempting to allow more than the max allowed granules in a batch. `
        + `Configured to use ${batchSize}, but will be limited to ${env.maxGranuleLimit}`);
    }
  }
}

/**
 * Returns the service configuration. Makes a clone copy so that a caller cannot
 * mutate the service configs used in this namespace.
 *
 * @returns a copy of the service configurations
 */
export function getServiceConfigs(): ServiceConfig<unknown>[] {
  return _.cloneDeep(serviceConfigs);
}

// Load config at require-time to ensure presence / validity early
loadServiceConfigs();
serviceConfigs.forEach(validateServiceConfig);
export const harmonyCollections = _.flatten(serviceConfigs.map((c) => c.collections));

const serviceTypesToServiceClasses = {
  http: HttpService,
  argo: ArgoService,
  noOp: NoOpService,
};

/**
 * Given a service configuration from services.yml and an operation, returns a
 * Service object for invoking that operation using the given service
 * @param serviceConfig - The configuration from services.yml
 * @param operation - The operation to perform
 * @returns An appropriate service for the given config
 * @throws NotFoundError - If no appropriate service can be found
 */
export function buildService(
  serviceConfig: ServiceConfig<unknown>,
  operation: DataOperation,
): BaseService<unknown> {
  const ServiceClass = serviceTypesToServiceClasses[serviceConfig.type.name];
  if (!ServiceClass) {
    throw new NotFoundError(`Could not find an appropriate service class for type "${serviceConfig.type}"`);
  }

  return new ServiceClass(serviceConfig, operation);
}

/**
 *  Returns any services that support concatenation from the list of configs
 * @param configs - The potential matching service configurations
 * @returns any configurations that support concatenation
 */
function supportsConcatenation(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.concatenation', false));
}

/**
 * Returns true if all of the collections in the given operation can be operated on by
 * the given service.
 *
 * @param operation - The operation to match
 * @param serviceConfig - A configuration for a single service from services.yml
 * @returns true if all collections in the operation are compatible with the service and
 *     false otherwise
 */
function isCollectionMatch(
  operation: DataOperation,
  serviceConfig: ServiceConfig<unknown>,
): boolean {
  return operation.sources.every((source) => serviceConfig.collections.includes(source.collection));
}

/**
 * Returns the services that can be used based on the requested format
 * @param format - Additional context that's not part of the operation, but influences the
 *    choice regarding the service to use
 * @param configs - The configuration to use for finding the operation, with all
 *    variables resolved (default: the contents of config/services.yml)
 * @returns An object with two properties - service and format for the service and format
 * that should be used to fulfill the given request context
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
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @returns The output format to use
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
 * Returns true if the operation requires reformatting
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @returns true if the provided operation requires reformatting and false otherwise
 */
function requiresReformatting(operation: DataOperation, context: RequestContext): boolean {
  if (operation.outputFormat) {
    return true;
  }

  if (context.requestedMimeTypes && context.requestedMimeTypes.length > 0) {
    const anyMimeTypes = context.requestedMimeTypes.filter((m) => allowsAny(m));
    if (anyMimeTypes.length === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if the operation requires concatenation
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires concatenation and false otherwise
 */
function requiresConcatenation(operation: DataOperation): boolean {
  return operation.shouldConcatenate;
}

/**
 * Returns true if the operation requires variable subsetting
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires variable subsetting and false otherwise
 */
function requiresVariableSubsetting(operation: DataOperation): boolean {
  return operation.shouldVariableSubset;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support variable subsetting
 */
function supportsVariableSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.variable', false));
}

/**
 * Returns true if the operation requires spatial subsetting
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires spatial subsetting
 */
function requiresSpatialSubsetting(operation: DataOperation): boolean {
  return operation.shouldSpatialSubset;
}

/**
 * Returns any services that support spatial subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support spatial subsetting
 */
function supportsSpatialSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.bbox', false));
}

/**
 * Returns true if the operation requires reprojection
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires reprojection and false otherwise
 */
function requiresReprojection(operation: DataOperation): boolean {
  return !!operation.crs;
}

/**
 * Returns any services that support reprojection from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support reprojection
 */
function supportsReprojection(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.reprojection', false));
}

/**
 * Returns true if the operation requires shapefile subsetting
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires shapefile subsetting and false otherwise
 */
function requiresShapefileSubsetting(operation: DataOperation): boolean {
  return !!operation.geojson;
}

/**
 * Returns any services that support shapefile subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support shapefile subsetting
 */
function supportsShapefileSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.shape', false));
}

const noOpService: ServiceConfig<void> = {
  name: 'noOpService',
  type: { name: 'noOp' },
  capabilities: { output_formats: ['application/json'] },
};

class UnsupportedOperation extends Error {
  operation: DataOperation;

  requestedOperations: string[];

  /**
   * Creates an instance of an UnsupportedOperation
   */
  constructor(
    operation: DataOperation,
    requestedOperations: string[],
    message = 'Unsupported Operation',
  ) {
    super(message);
    this.operation = operation;
    this.requestedOperations = requestedOperations;
  }
}

/**
 * Returns any services that support concatenation from the list of configs
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support concatenation
 */
function filterConcatenationMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let matches = configs;
  if (requiresConcatenation(operation)) {
    requestedOperations.push('concatenation');
    matches = supportsConcatenation(configs);
  }

  if (matches.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return matches;
}

/**
 * Returns any services that support the collection in the operation from the list of configs
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support the provided collection
 */
function filterCollectionMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  const matches = configs.filter((config) => isCollectionMatch(operation, config));
  if (matches.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return matches;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support this operation based on variable
 * subsetting constraints
 */
function filterVariableSubsettingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let matches = configs;
  if (requiresVariableSubsetting(operation)) {
    requestedOperations.push('variable subsetting');
    matches = supportsVariableSubsetting(configs);
  }

  if (matches.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return matches;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support the requested output format
 */
function filterOutputFormatMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = [];
  if (requiresReformatting(operation, context)) {
    const fmts = operation.outputFormat ? [operation.outputFormat] : context.requestedMimeTypes;
    requestedOperations.push(`reformatting to ${listToText(fmts, Conjunction.OR)}`);
    const outputFormat = selectFormat(operation, context, configs);
    if (outputFormat) {
      services = selectServicesForFormat(outputFormat, configs);
    }
  } else {
    services = configs;
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support spatial subsetting from the list of configs if the operation
 * requires spatial subsetting.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support the requested output format
 */
function filterSpatialSubsettingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresSpatialSubsetting(operation)) {
    requestedOperations.push('spatial subsetting');
    services = supportsSpatialSubsetting(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support reprojection from the list of configs if the operation
 * requires reprojection.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support the requested output format
 */
function filterReprojectionMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresReprojection(operation)) {
    requestedOperations.push('reprojection');
    services = supportsReprojection(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support shapefile subsetting from the list of configs if the operation
 * requires shapefile subsetting.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that support the requested output format
 */
function filterShapefileSubsettingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresShapefileSubsetting(operation)) {
    requestedOperations.push('shapefile subsetting');
    services = supportsShapefileSubsetting(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, requestedOperations);
  }
  return services;
}

/**
 * For certain UnsupportedOperation errors the root cause will be a combination of multiple
 * request parameters such as requesting variable subsetting and a specific output format.
 * This function will return a detailed message on what combination was unsupported.
 * @param error - The UnsupportedOperation that occurred.
 * @returns the reason the operation was not supported
 */
function unsupportedCombinationMessage(error: UnsupportedOperation): string {
  const { operation, requestedOperations } = error;
  const collections = operation.sources.map((s) => s.collection);

  let message = `no operations can be performed on ${listToText(collections)}`;
  if (requestedOperations.length > 0) {
    message = `the requested combination of operations: ${listToText(requestedOperations)}`
      + ` on ${listToText(collections)} is unsupported`;
  }
  return message;
}

type FilterFunction = (
  // The operation to perform
  operation: DataOperation,
  // Request specific context that is not part of the operation model
  context: RequestContext,
  // All service configurations that have matched so far.
  configs: ServiceConfig<unknown>[],
  // Operations requested to be performed. Used for messages when no services could be
  // found to fulfill the request.
  requestedOperations: string[])
=> ServiceConfig<unknown>[];

// List of filter functions to call to identify the services that can support an operation.
// The functions will be chained in the specified order passing in the list of services
// that would work for each into the next filter function in the chain.
// All filter functions use the FilterFunction type signature.
const allFilterFns = [
  filterCollectionMatches,
  filterConcatenationMatches,
  filterVariableSubsettingMatches,
  filterSpatialSubsettingMatches,
  filterShapefileSubsettingMatches,
  filterReprojectionMatches,
  // This filter must be last because it chooses a format based on the accepted MimeTypes and
  // the remaining services that could support the operation. If it ran earlier we could
  // potentially eliminate services that a different accepted MimeType would have allowed. We
  // should re-evaluate when we implement chaining to see if this approach continues to make sense.
  filterOutputFormatMatches,
];

// In some cases we want to do as much as we can for a request rather than rejecting it
// because not all of the requested services could be applied. This list of functions omits
// filter functions that are considered optional for matching.
const requiredFilterFns = [
  filterCollectionMatches,
  filterConcatenationMatches,
  filterVariableSubsettingMatches,
  filterReprojectionMatches,
  // See caveat above in allFilterFns about why this filter must be applied last
  filterOutputFormatMatches,
];

const bestEffortMessage = 'Data in output files may extend outside the spatial bounds you requested.';

/**
 * Returns true if the collectionId has available backends
 *
 * @param collection - The CMR collection to check
 * @returns true if the collection has available backends, false otherwise
 */
export function isCollectionSupported(collection: CmrCollection): boolean {
  return serviceConfigs.find((sc) => sc.collections.includes(collection.id)) !== undefined;
}

/**
 * Returns the service configuration to use for the given data operation and request context
 * by using the provided filter functions.
 * @param operation - The operation to perform. Note that this function may mutate the operation.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - The configuration to use for finding the operation, with all variables
 *     resolved (default: the contents of config/services.yml)
 * @param filterFns - The list of filter functions to execute to filter matching services
 * @returns the service configuration to use
 */
function filterServiceConfigs(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  filterFns: FilterFunction[],
): ServiceConfig<unknown> {
  let serviceConfig;
  let matches = configs;
  const requestedOperations = [];
  try {
    for (const filterFn of filterFns) {
      matches = filterFn(operation, context, matches, requestedOperations);
    }
    const outputFormat = selectFormat(operation, context, matches);
    if (outputFormat) {
      operation.outputFormat = outputFormat; // eslint-disable-line no-param-reassign
      matches = selectServicesForFormat(outputFormat, matches);
    }
    serviceConfig = matches[0];
  } catch (e) {
    if (e instanceof UnsupportedOperation) {
      noOpService.message = unsupportedCombinationMessage(e);
      logger.info(`Returning download links because ${noOpService.message}.`);
      serviceConfig = noOpService;
    } else {
      throw e;
    }
  }
  return serviceConfig;
}

/**
 * Whether the operation should be strictly matched against the service capabilities.
 * For example if the request contains spatial subsetting and reformatting it is
 * optional for the spatial subsetting to be performed but required for the reformatting.
 *
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @returns true if the operation needs to have all capabilities strictly matched
 *     and false otherwise
 */
function requiresStrictCapabilitiesMatching(
  operation: DataOperation,
  context: RequestContext,
): boolean {
  let strictMatching = false;
  if ((!requiresSpatialSubsetting(operation) && !requiresShapefileSubsetting(operation))
      || (!requiresVariableSubsetting(operation) && !requiresReprojection(operation)
      && !requiresReformatting(operation, context))) {
    strictMatching = true;
  }
  return strictMatching;
}

/**
 * Returns the service configuration to use for the given data operation and request context
 * @param operation - The operation to perform. Note that this function may mutate the operation.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - The configuration to use for finding the operation, with all variables
 *     resolved (default: the contents of config/services.yml)
 * @returns the service configuration to use
 */
export function chooseServiceConfig(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[] = serviceConfigs,
): ServiceConfig<unknown> {
  let serviceConfig = filterServiceConfigs(operation, context, configs, allFilterFns);
  // if we are asked to concatenate, but no matching concat service is available then throw an error
  if (serviceConfig.name === 'noOpService' && operation.shouldConcatenate) {
    throw new NotFoundError('no matching service');
  }
  if (serviceConfig.name === 'noOpService' && !requiresStrictCapabilitiesMatching(operation, context)) {
    // if we couldn't find a matching service, make a best effort to find a service that
    // can do part of what the operation requested
    serviceConfig = filterServiceConfigs(operation, context, configs, requiredFilterFns);
    if (serviceConfig.name !== 'noOpService') {
      serviceConfig = _.cloneDeep(serviceConfig);
      serviceConfig.message = bestEffortMessage;
    }
  }
  return serviceConfig;
}
