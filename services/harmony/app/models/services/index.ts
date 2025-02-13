import * as fs from 'fs';
import * as yaml from 'js-yaml';
import _, { get as getIn } from 'lodash';
import * as path from 'path';

import { Conjunction, isInteger, listToText } from '@harmony/util/string';

import { addCollectionsToServicesByAssociation } from '../../middleware/service-selection';
import { CmrCollection } from '../../util/cmr';
import { allowsAny, isMimeTypeAccepted } from '../../util/content-negotiation';
import env from '../../util/env';
import { HttpError, NotFoundError, ServerError } from '../../util/errors';
import logger from '../../util/log';
import DataOperation from '../data-operation';
import RequestContext from '../request-context';
import BaseService, { ServiceConfig } from './base-service';
import HttpService from './http-service';
import TurboService from './turbo-service';

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
 * Update the given service configuration collections to empty array if it is undefined.
 */
function updateCollectionsConfig(config: ServiceConfig<unknown>): void {
  if (config.collections === undefined) {
    config.collections = [];
  }
  const variableName = `${config.name.toUpperCase().replace(/-/g, '_')}_COLLECTIONS`;
  const collectionString = process.env[variableName];
  if (collectionString) {
    const collections = collectionString.split(',');
    const serviceCollections = collections.map((c) => ({ id: c }));
    config.collections.push(...serviceCollections);
  }
}

/**
 * Loads the services configuration from the given file.
 * @param cmrEndpoint - The CMR endpoint url
 * @param fileName - The path to the services configuation file
 * @returns the parsed services configuration
 */
export function loadServiceConfigsFromFile(cmrEndpoint: string, fileName: string): ServiceConfig<unknown>[] {
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
    : fs.readFileSync(path.join(__dirname, fileName));
  const schema = yaml.DEFAULT_SCHEMA.extend([EnvType]);
  const envConfigs = yaml.load(buffer.toString(), { schema });
  const configs = envConfigs[cmrEndpoint]
    .filter((config) => config.enabled !== false && config.enabled !== 'false');
  configs.forEach(sc => updateCollectionsConfig(sc));
  return configs;
}

/**
 * Loads the services configuration file.
 * @param cmrEndpoint - The CMR endpoint url
 * @returns the parsed services configuration
 */
export function loadServiceConfigs(cmrEndpoint: string): ServiceConfig<unknown>[] {
  return loadServiceConfigsFromFile(cmrEndpoint, '../../../../../config/services.yml');
}

/**
 * Throws an error if the steps configuration is invalid. Logs a warning if configuration will be ignored.
 * @param config - The service configuration to validate
 */
function validateServiceConfigSteps(config: ServiceConfig<unknown>): void {
  const steps = config.steps || [];
  for (const step of steps) {
    const maxBatchInputs = step.max_batch_inputs;
    if (maxBatchInputs !== undefined) {
      if (!_.isInteger(maxBatchInputs)) {
        throw new TypeError(`Invalid max_batch_inputs ${maxBatchInputs}. Max batch inputs must be an integer greater than or equal to 1.`);
      }
      if (maxBatchInputs <= 0) {
        throw new TypeError(`Invalid max_batch_inputs ${maxBatchInputs}. Max batch inputs must be greater than or equal to 1.`);
      }
      if (maxBatchInputs > env.maxGranuleLimit) {
        logger.warn(`Service ${config.name} attempting to allow more than the max allowed granules in a batch. `
          + `Configured to use ${maxBatchInputs}, but will be limited to ${env.maxGranuleLimit}`);
      }
    }
    if (step.image.match(/harmonyservices\/query\-cmr:.*/)) {
      if (!step.is_sequential) {
        throw new TypeError(`Invalid is_sequential ${step.is_sequential}. query-cmr steps must always have sequential = true.`);
      }
    }
  }
}

/**
 * Throws an error if the configuration is invalid. Logs a warning if configuration will be ignored.
 * @param config - The service configuration to validate
 */
export function validateServiceConfig(config: ServiceConfig<unknown>): void {
  const variableName = `${config.name.toUpperCase().replace(/-/g, '_')}_COLLECTIONS`;
  const collectionString = process.env[variableName];
  if (!collectionString) {
    if (!config.capabilities.all_collections) {
      if (config.umm_s === undefined || config.umm_s === '' || typeof config.umm_s !== 'string') {
        throw new ServerError(`There must be one and only one umm_s record configured as a string for harmony service: ${config.name}`);
      }

      for (const coll of config.collections) {
        if (coll && (!coll.variables && !coll.granule_limit)) {
          throw new ServerError(`Collections cannot be configured for harmony service: ${config.name}, use umm_s instead.`);
        }
      }
    }
  } else {
    logger.warn(`Collections are manually set using environment variable for service ${config.name} with collections ${JSON.stringify(config.collections)}`);
  }

  validateServiceConfigSteps(config);
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
serviceConfigs = loadServiceConfigs(env.cmrEndpoint);
serviceConfigs.forEach(validateServiceConfig);
export const serviceNames = serviceConfigs.map((c) => c.name);

/**
 * Reset the service configuration so that new environment variable values
 * can be applied to services.yml.
 */
export function resetServiceConfigs(): void {
  serviceConfigs = loadServiceConfigs(env.cmrEndpoint);
}

const serviceTypesToServiceClasses = {
  http: HttpService,
  turbo: TurboService,
};

/**
 * For a given list of collections, return a list of collection concept ids that have Harmony services defined via
 * the umm-s associations in services.yml. This is used to filter out any collections that do not have services associated,
 * so we only deal with collections that are applicable to Harmony services.
 * @param collections - an initial list of collections
 * @returns a list of collection concept ids that have Harmony serices
 */
export function harmonyCollections(
  collections: CmrCollection[],
): string[] {
  const allServiceConfigs = addCollectionsToServicesByAssociation(collections);
  return _.flatten(allServiceConfigs.map((c) => c.collections.map((sc) => sc.id)));
}

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
 * Returns any services that support concatenation from the list of configs
 *
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
  context: RequestContext,
  serviceConfig: ServiceConfig<unknown>,
): boolean {
  return serviceConfig.capabilities?.all_collections || context.collectionIds.every((collectionId) => {
    return serviceConfig.collections?.map((sc) => sc.id).includes(collectionId);
  });
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
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @returns true if the provided operation requires variable subsetting and false otherwise
 */
function requiresVariableSubsetting(context: RequestContext): boolean {
  return context.requestedVariables?.length > 0;
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
  return operation.shouldReproject;
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
  return operation.shouldShapefileSubset;
}

/**
 * Returns any services that support shapefile subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support shapefile subsetting
 */
function supportsShapefileSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.shape', false));
}

/**
 * Returns true if the operation requires temporal subsetting
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires temporal subsetting and false otherwise
 */
function requiresTemporalSubsetting(operation: DataOperation): boolean {
  return operation.shouldTemporalSubset;
}

/**
 * Returns any services that support temporal subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support temporal subsetting
 */
function supportsTemporalSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.temporal', false));
}

/**
 * Returns true if the operation requires dimension extension
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires dimension extension and false otherwise
 */
function requiresExtend(operation: DataOperation): boolean {
  return operation.extendDimensions && operation.extendDimensions.length > 0;
}

/**
 * Returns any services that support dimension extension from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support dimension extension
 */
function supportsExtend(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.extend', false));
}

/**
 * Returns true if the operation requires dimension subsetting
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires dimension subsetting and false otherwise
 */
function requiresDimensionSubsetting(operation: DataOperation): boolean {
  return operation.shouldDimensionSubset;
}

/**
 * Returns any services that support dimension subsetting from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support dimension subsetting
 */
function supportsDimensionSubsetting(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.dimension', false));
}

/**
 * Returns true if the operation requires time averaging
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires time averaging and false otherwise
 */
function requiresTimeAveraging(operation: DataOperation): boolean {
  return operation.average === 'time';
}

/**
 * Returns any services that support time averaging from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support time averaging
 */
function supportsTimeAveraging(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.averaging.time', false));
}

/**
 * Returns true if the operation requires area averaging
 * @param operation - The operation to perform.
 * @returns true if the provided operation requires area averaging and false otherwise
 */
function requiresAreaAveraging(operation: DataOperation): boolean {
  return operation.average === 'area';
}

/**
 * Returns any services that support area averaging from the list of configs
 * @param configs - The potential matching service configurations
 * @returns Any configurations that support area averaging
 */
function supportsAreaAveraging(configs: ServiceConfig<unknown>[]): ServiceConfig<unknown>[] {
  return configs.filter((config) => getIn(config, 'capabilities.averaging.area', false));
}

export class UnsupportedOperation extends HttpError {
  operation: DataOperation;

  context: RequestContext;

  requestedOperations: string[];

  constructor(operation: DataOperation, context: RequestContext, requestedOperations: string[]) {
    const collections = context.collectionIds;

    let message = `no operations can be performed on ${listToText(collections)}`;
    if (requestedOperations.length > 0) {
      message = `the requested combination of operations: ${listToText(requestedOperations)}`
        + ` on ${listToText(collections)} is unsupported`;
    }
    super(422, message);
    this.operation = operation;
    this.context = context;
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
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
  const matches = configs.filter((config) => isCollectionMatch(operation, context, config));
  if (matches.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
  if (requiresVariableSubsetting(context)) {
    requestedOperations.push('variable subsetting');
    matches = supportsVariableSubsetting(configs);
  }

  if (matches.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
 * @returns Any service configurations that could still support the request
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
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
 * @returns Any service configurations that could still support the request
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
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
 * @returns Any service configurations that could still support the request
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
    throw new UnsupportedOperation(operation, context, requestedOperations);
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
 * @returns Any service configurations that could still support the request
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
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support temporal subsetting from the list of configs if the
 * operation requires temporal subsetting.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that could still support the request
 */
function filterTemporalSubsettingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresTemporalSubsetting(operation)) {
    requestedOperations.push('temporal subsetting');
    services = supportsTemporalSubsetting(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support dimension extension from the list of configs if the
 * operation requires dimension extension.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that could still support the request
 */
function filterExtendMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresExtend(operation)) {
    requestedOperations.push('extend');
    services = supportsExtend(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support arbitrary dimension subsetting from the list of configs
 * if the operation requires dimension subsetting.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that could still support the request
 */
function filterDimensionSubsettingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresDimensionSubsetting(operation)) {
    requestedOperations.push('dimension subsetting');
    services = supportsDimensionSubsetting(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support time averaging from the list of configs
 * if the operation requires time averaging.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that could still support the request
 */
function filterTimeAveragingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresTimeAveraging(operation)) {
    requestedOperations.push('time averaging');
    services = supportsTimeAveraging(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
}

/**
 * Returns any services that support area averaging from the list of configs
 * if the operation requires area averaging.
 * @param operation - The operation to perform.
 * @param context - Additional context that's not part of the operation, but influences the
 *     choice regarding the service to use
 * @param configs - All service configurations that have matched up to this call
 * @param requestedOperations - Operations that have been considered in filtering out services up to
 *     this call
 * @returns Any service configurations that could still support the request
 */
function filterAreaAveragingMatches(
  operation: DataOperation,
  context: RequestContext,
  configs: ServiceConfig<unknown>[],
  requestedOperations: string[],
): ServiceConfig<unknown>[] {
  let services = configs;
  if (requiresAreaAveraging(operation)) {
    requestedOperations.push('area averaging');
    services = supportsAreaAveraging(configs);
  }

  if (services.length === 0) {
    throw new UnsupportedOperation(operation, context, requestedOperations);
  }
  return services;
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
  filterTemporalSubsettingMatches,
  filterDimensionSubsettingMatches,
  filterReprojectionMatches,
  filterExtendMatches,
  filterAreaAveragingMatches,
  filterTimeAveragingMatches,
  filterShapefileSubsettingMatches,
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
  filterDimensionSubsettingMatches,
  filterReprojectionMatches,
  filterExtendMatches,
  filterAreaAveragingMatches,
  filterTimeAveragingMatches,
  // See caveat above in allFilterFns about why this filter must be applied last
  filterOutputFormatMatches,
];

const bestEffortMessage = 'Data in output files may extend outside the spatial and temporal bounds you requested.';

/**
 * Returns true if the collectionId has available backends
 *
 * @param collection - The CMR collection to check
 * @returns true if the collection has available backends, false otherwise
 */
export function isCollectionSupported(collection: CmrCollection): boolean {
  const allServiceConfigs = addCollectionsToServicesByAssociation([collection]);
  return allServiceConfigs.some((sc) => sc.collections.map((c) => c.id).includes(collection.id));
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
  let matches = configs;
  const requestedOperations = [];
  for (const filterFn of filterFns) {
    matches = filterFn(operation, context, matches, requestedOperations);
  }
  const outputFormat = selectFormat(operation, context, matches);
  if (outputFormat) {
    operation.outputFormat = outputFormat; // eslint-disable-line no-param-reassign
    matches = selectServicesForFormat(outputFormat, matches);
  }
  const serviceConfig = matches[0];

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
  const wantsSpatialSubsetting = requiresSpatialSubsetting(operation)
    || requiresShapefileSubsetting(operation);
  const wantsTemporalSubsetting = requiresTemporalSubsetting(operation);

  if (!wantsSpatialSubsetting && !wantsTemporalSubsetting) {
    // Request is not asking for any of the potential operations that we can ignore
    // in best effort matching, so we can make matching strict
    return true;
  }

  if (wantsSpatialSubsetting && wantsTemporalSubsetting) {
    // Request wants both optional operations so do not make matching strict
    return false;
  }

  if (
    // Request is only asking for one of temporal or spatial subsetting and
    // is not asking for any other operation, so force making matching strict
    !requiresVariableSubsetting(context)
    && !requiresReprojection(operation)
    && !requiresReformatting(operation, context)
    && !requiresConcatenation(operation)
    && !requiresDimensionSubsetting(operation)
    && !requiresExtend(operation)
  ) {
    return true;
  }

  // Any other scenario
  return false;
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
  let serviceConfig;
  try {
    serviceConfig = filterServiceConfigs(operation, context, configs, allFilterFns);
  } catch (e) {
    if (e instanceof UnsupportedOperation) {
      if (!requiresStrictCapabilitiesMatching(operation, context)) {
        // if we couldn't find a matching service, make a best effort to find a service that
        // can do part of what the operation requested
        serviceConfig = filterServiceConfigs(operation, context, configs, requiredFilterFns);
        serviceConfig = _.cloneDeep(serviceConfig);
        serviceConfig.message = bestEffortMessage;
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }

  return serviceConfig;
}
