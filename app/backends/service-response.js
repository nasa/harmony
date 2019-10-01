const uuid = require('uuid');
const log = require('../util/log');

const config = {
};

// TODO: As far as I can tell, there's no way to use a WeakMap here.
// We will need to clean these up or risk leaks.
const idsToCallbacks = new Map();

/**
 * Removes a callback URL / function binding.  Does nothing if url is null
 *
 * @param {string} url The URL of the response to forget
 * @returns {void}
 */
function unbindResponseUrl(url) {
  if (url) {
    idsToCallbacks.delete(url.split('/').last);
  }
}

/**
 * Binds a function to be run when a unique URL is called from a backend service
 *
 * @param {function} responseCallback A callback run when the URL is loaded
 * @returns {string} The url the backend should call to invoke the function
 */
function bindResponseUrl(responseCallback) {
  if (!config.baseUrl) {
    throw new Error('Call configure({ baseUrl }) before calling createResponseUrl');
  }
  const callbackUUID = uuid();
  idsToCallbacks.set(callbackUUID, {
    response: responseCallback,
  });
  log.info('Callbacks size', idsToCallbacks.size);
  return config.baseUrl + callbackUUID;
}

/**
 * Express.js handler on a service-facing endpoint that receives responses
 * from backends and calls the registered callback for those responses
 *
 * @param {http.IncomingMessage} req The request sent by the service
 * @param {http.ServerResponse} res The response to send to the service
 * @returns {void}
 */
function responseHandler(req, res) {
  const id = req.params.uuid;
  if (!idsToCallbacks.get(id)) {
    throw new Error(`Could not find response callback for UUID ${id}`);
  }
  const callback = idsToCallbacks.get(id).response;

  try {
    callback(req, res);
  } finally {
    idsToCallbacks.delete(id);
  }
}

/**
 * Provides global configuration to service responses.  Only call this once.
 * Configuration:
 *   baseUrl: The base URL of the internal-facing endpoint that unique paths are appended to
 *
 * @param {{baseUrl: string}} config Configuration containing the base URL of the endpoint
 * @returns {void}
 */
function configure({ baseUrl }) {
  if (baseUrl) {
    if (config.baseUrl) {
      throw new Error(`ServiceResponse baseUrl ${config.baseUrl} would be overwritten by ${baseUrl}`);
    }
    config.baseUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/');
  }
}

module.exports = {
  responseHandler,
  bindResponseUrl,
  unbindResponseUrl,
  configure,
};
