const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const LocalDockerService = require('./local-docker-service');
const ChainService = require('./chain-service');
const { NotFoundError } = require('../../util/errors');

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
  serviceConfigs = yaml.load(buffer, { schema });
}

// Load config at require-time to ensure presence / validity early
loadServiceConfigs();

const serviceTypesToServiceClasses = {
  docker: LocalDockerService,
  chain: ChainService,
};

/**
 * Given a service configuration from services.yml and an operation, returns a
 * Service object for invoking that operation using the given service
 *
 * @param {object} serviceConfig The configuration from services.yml
 * @param {DataOperation} operation The data operation being performed
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
 * Given a data operation, returns a service instance appropriate for performing that operation
 *
 * @param {DataOperation} operation The operation to build a service for
 * @returns {BaseService} A service instance appropriate for performing the operation
 * @throws {Error} If no service can perform the given operation
 */
function forOperation(operation) {
  let matches = [];
  if (operation) {
    matches = serviceConfigs.filter((config) => isCollectionMatch(operation, config));
  }
  if (matches.length === 0) {
    throw new NotFoundError('Could not find a service to fulfill the request for the given collection');
  }

  // TODO: Capabilities match.  Should be fuzzier and warn, rather than erroring?

  return buildService(matches[0], operation);
}

/**
 * Constructs and returns a service instance whose config has the given name in services.yml
 *
 * @param {*} name The name of the service as it appears in services.yml
 * @param {*} operation The operation the service instance is serving
 * @returns {BaseService} The constructed service
 */
function forName(name, operation) {
  const match = serviceConfigs.find((config) => config.name === name);
  if (!match) {
    throw new NotFoundError(`Could not find service with name ${name}`);
  }
  return buildService(match, operation);
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
exports.forName = forName;
exports.isCollectionSupported = isCollectionSupported;
