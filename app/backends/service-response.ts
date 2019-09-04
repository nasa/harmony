const uuid = require('uuid');
const log = require('../util/log');

const config = {
};

// TODO: As far as I can tell, there's no way to use a WeakMap here.
// We will need to clean these up or risk leaks.
const idsToCallbacks = new Map();

function unbindResponseUrl(url) {
  if (url) {
    idsToCallbacks.delete(url.split('/').last);
  }
}

function bindResponseUrl(responseCallback) {
  if (!config.baseUrl) {
    throw new Error('Call configure({ baseUrl }) before calling createResponseUrl');
  }
  const callbackUUID = uuid();
  idsToCallbacks.set(callbackUUID, {
    response: responseCallback,
  });
  // TODO: Implement util/log to use winston
  log.info('Callbacks size', idsToCallbacks.size);
  return config.baseUrl + callbackUUID;
}

function responseHandler(req, res) {
  const id = req.params.uuid;
  const callback = idsToCallbacks.get(id).response;
  if (!callback) {
    throw new Error(`Could not find response callback for UUID ${id}`);
  }

  try {
    callback(req, res);
  } finally {
    idsToCallbacks.delete(id);
  }
}

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
