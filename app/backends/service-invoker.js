const services = require('../models/services');
const env = require('../util/env');
const { ServiceError } = require('../util/errors');

/**
 * Copies the header with the given name from the given request to the given response
 *
 * @param {http.IncomingMessage} serviceResult The service result to copy from
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
 * @param {http.IncomingMessage} serviceResult The service result
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 * @throws {ServiceError} If the backend service returns an error
 */
function translateServiceResult(serviceResult, res) {
  for (const k of Object.keys(serviceResult.headers)) {
    if (k.toLowerCase().startsWith('harmony')) {
      copyHeader(serviceResult, res, k);
    }
  }
  if (serviceResult.error) {
    throw new ServiceError(serviceResult.statusCode || 400, serviceResult.error);
  } else if (serviceResult.redirect) {
    res.redirect(serviceResult.redirect);
  } else {
    copyHeader(serviceResult, res, 'Content-Type');
    copyHeader(serviceResult, res, 'Content-Length');
    serviceResult.stream.pipe(res);
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
 */
async function serviceInvoker(req, res) {
  const startTime = new Date().getTime();
  req.operation.user = req.user || 'anonymous';
  req.operation.client = env.harmonyClientId;
  const service = services.forOperation(req.operation, req.logger);
  let serviceResult = null;
  try {
    serviceResult = await service.invoke();
    translateServiceResult(serviceResult, res);
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
}

module.exports = serviceInvoker;
