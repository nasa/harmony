const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const getIn = require('lodash.get');

const LocalDockerService = require('./local-docker-service');
const HttpService = require('./http-service');
const NoOpService = require('./no-op-service');
const { NotFoundError } = require('../../util/errors');
const { isMimeTypeAccepted } = require('../../util/content-negotiation');

let serviceConfigs = null;

/**
 * Loads the subsetter-config.yml configuration file.
 *
 * @returns {void}
 */
function loadServiceConfigs() {
  // Setup a type, !Env, that when placed in front of a string resolves substrings like
  // "${some_env_var}" to the corresponding environment variable
  const regex = /\$\{(\w+)\}/g;
  const EnvType = new yaml.Type('!Env', {
    kind: 'scalar',
    resolve: (data) => data,
    construct: (data) => data.replace(regex, (env) => process.env[env.match(/\w+/)] || ''),
  });

  // Load the config
  const buffer = fs.readFileSync(path.join(__dirname, '../../../config/services.yml'));
  const schema = yaml.Schema.create([EnvType]);
  serviceConfigs = yaml.load(buffer, { schema }).filter((config) => config.enabled !== false && config.enabled !== 'false');
}

// Load config at require-time to ensure presence / validity early
loadServiceConfigs();

const serviceTypesToServiceClasses = {
  docker: LocalDockerService,
  http: HttpService,
  noOp: NoOpService,
};

/**
 * Given a service configuration from services.yml and an operation, returns a
 * Service object for invoking that operation using the given service
 * @param {object} serviceConfig The configuration from services.yml
 * @param {DataOperation} operation The operation to perform
 * @returns {Service} An appropriate service for the given config
 */
function buildService(serviceConfig, operation) {
  const ServiceClass = serviceTypesToServiceClasses[serviceConfig.type.name];
  if (ServiceClass) {
    return new ServiceClass(serviceConfig, operation);
  }

  throw new NotFoundError(`Could not find an appropriate service class for type "${serviceConfig.type}"`);
}

/**
 * Returns true if all of the collections in the given operation can be operated on by
 * the given service.
 *
 * @param {DataOperation} operation The operation to match
 * @param {object} serviceConfig A configuration for a single service from services.yml
 * @returns {boolean} true if all collections in the operation are compatible with the service
 */
function isCollectionMatch(operation, serviceConfig) {
  return operation.sources.every((source) => serviceConfig.collections.includes(source.collection));
}

/**
 * Returns the service to use based on the requested format
 * @param {String} format Additional context that's not part of the operation, but influences the
 *    choice regarding the service to use
 * @param {Object} configs The configuration to use for finding the operation, with all variables
 *    resolved (default: the contents of config/services.yml)
 * @returns {Object} An object with two properties - service and format for the service and format
 * that should be used to fulfill the given request context
 * @private
 */
function _selectServiceForFormat(format, configs) {
  return configs.find((config) => {
    const supportedFormats = getIn(config, 'capabilities.output_formats', []);
    return supportedFormats.find((f) => isMimeTypeAccepted(f, format));
  });
}

/**
 * Returns the service and format to use based on the request context and service configs
 * @param {DataOperation} operation The operation to perform.
 * @param {Object} context Additional context that's not part of the operation, but influences the
 *    choice regarding the service to use
 * @param {Object} configs The potential matching service configurations
 * @returns {String} The output format to use
 * @private
 */
function _selectFormat(operation, context, configs) {
  let { outputFormat } = operation;
  if (!outputFormat && context.requestedMimeTypes && context.requestedMimeTypes.length > 0) {
    for (const mimeType of context.requestedMimeTypes) {
      const service = _selectServiceForFormat(mimeType, configs);
      if (service) {
        const supportedFormats = getIn(service, 'capabilities.output_formats', []);
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
function _requiresVariableSubsetting(operation) {
  const varSources = operation.sources.filter((s) => s.variables && s.variables.length > 0);
  return varSources.length > 0;
}

/**
 * Returns any services that support variable subsetting from the list of configs
 * @param {Array<Object>} configs The potential matching service configurations
 * @returns {Array<Object>} Any configurations that support variable subsetting
 * @private
 */
function _supportsVariableSubsetting(configs) {
  return configs.filter((config) => getIn(config, 'capabilities.subsetting.variable', false));
}

const noOpService = {
  type: { name: 'noOp' },
  capabilities: { output_formats: ['application/json'] },
};

/**
 * Given a data operation, returns a service instance appropriate for performing that operation.
 * The operation may also be mutated to set additional properties as part of this function.
 *
 * @param {DataOperation} operation The operation to perform. Note that this function may mutate
 *    the operation.
 * @param {Object} context Additional context that's not part of the operation, but influences the
 *    choice regarding the service to use
 * @param {Object} configs The configuration to use for finding the operation, with all variables
 *    resolved (default: the contents of config/services.yml)
 * @returns {BaseService} A service instance appropriate for performing the operation
 * @throws {NotFoundError} If no service can perform the given operation
 */
function forOperation(operation, context, configs = serviceConfigs) {
  let matches = [];
  if (operation) {
    matches = configs.filter((config) => isCollectionMatch(operation, config));
  }

  let noOpReason;
  if (matches.length === 0) {
    noOpReason = 'no services are configured for the collection';
  }

  if (_requiresVariableSubsetting(operation)) {
    matches = _supportsVariableSubsetting(matches);
  }

  if (matches.length === 0 && !noOpReason) {
    noOpReason = 'none of the services configured for the collection support variable subsetting';
  }

  let service;
  if (operation.outputFormat
    || (context && context.requestedMimeTypes && context.requestedMimeTypes.length > 0)) {
    const outputFormat = _selectFormat(operation, context, matches);
    if (outputFormat) {
      // eslint-disable-next-line no-param-reassign
      operation.outputFormat = outputFormat;
      service = _selectServiceForFormat(outputFormat, matches);
    }
  } else {
    [service] = matches;
  }

  if (!service && !noOpReason) {
    noOpReason = `none of the services configured for the collection support reformatting to any of the requested formats [${operation.outputFormat || context.requestedMimeTypes}]`;
  }

  if (!service) {
    noOpService.message = noOpReason;
    service = noOpService;
  }
  return buildService(service, operation);
}

/**
 * Returns true if the collectionId has available backends
 *
 * @param {string} collection The CMR collection to check
 * @returns {boolean} true if the collection has available backends, false otherwise
 */
function isCollectionSupported(collection) {
  return serviceConfigs.find((sc) => sc.collections.includes(collection.id)) !== undefined;
}

// Don't set module.exports or ChainService breaks
exports.forOperation = forOperation;
exports.isCollectionSupported = isCollectionSupported;
