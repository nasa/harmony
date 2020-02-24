const services = require('../models/services');
const env = require('../util/env');
const { ServiceError } = require('../util/errors');
const { objectStoreForProtocol } = require('../util/object-store');
const { getRequestRoot } = require('../util/url');

/**
 * Copies the header with the given name from the given request to the given response
 *
 * @param {Object<{
 *  headers: object
 * }>} serviceResult The service result to copy from
 * @param {http.ServerResponse} res The response to copy to
 * @param {string} header The name of the header to set
 * @returns {void}
 */
function copyHeader(serviceResult, res, header) {
  res.set(header, serviceResult.headers[header.toLowerCase()]);
}

/**
 * Translates the given request sent by a backend service into the given
 * response sent to the client.
 *
 * @param {Object<{
 *   error: string,
 *   redirect: string,
 *   body: http.IncomingMessage,
 * }>} serviceResult The service result
 * @param {string} user The user making the request
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 * @throws {ServiceError} If the backend service returns an error
 */
async function translateServiceResult(serviceResult, user, res) {
  for (const k of Object.keys(serviceResult.headers)) {
    if (k.toLowerCase().startsWith('harmony')) {
      copyHeader(serviceResult, res, k);
    }
  }
  const { error, statusCode, redirect, content, stream } = serviceResult;
  if (error) {
    throw new ServiceError(statusCode || 400, error);
  } else if (redirect) {
    const store = objectStoreForProtocol(redirect.split(':')[0]);
    let dest = redirect;
    if (store) {
      dest = await store.signGetObject(redirect, { 'x-user': user });
    }
    res.redirect(303, dest);
  } else if (content) {
    res.send(content);
  } else {
    copyHeader(serviceResult, res, 'Content-Type');
    copyHeader(serviceResult, res, 'Content-Length');
    stream.pipe(res);
  }
}

/**
 * Express.js handler that calls backend services, registering a URL for the backend
 * to POST to when complete.  Responds to the client once the backend responds.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 * @throws {ServiceError} if the service call fails or returns an error
 * @throws {NotFoundError} if no service can handle the callback
 */
async function serviceInvoker(req, res) {
  const startTime = new Date().getTime();
  req.operation.user = req.user || 'anonymous';
  req.operation.client = env.harmonyClientId;
  const service = services.forOperation(req.operation, req.logger, getRequestRoot(req));
  let serviceResult = null;
  try {
    service.truncationMessage = req.truncationMessage;
    serviceResult = await service.invoke();
    await translateServiceResult(serviceResult, req.operation.user, res);
  } finally {
    if (serviceResult && serviceResult.onComplete) {
      serviceResult.onComplete();
    }
  }
  const msTaken = new Date().getTime() - startTime;
  const { model } = service.operation;
  const spatialSubset = model.subset && Object.keys(model.subset).length > 0;
  // eslint-disable-next-line max-len
  const varSources = model.sources.filter((source) => source.variables && source.variables.length > 0);
  const variableSubset = varSources.length > 0;
  req.logger.info('Backend service request complete',
    { durationMs: msTaken,
      ...model,
      service: service.config.name,
      spatialSubset,
      variableSubset });
  return serviceResult;
}

module.exports = serviceInvoker;
