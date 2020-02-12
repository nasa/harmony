const services = require('../models/services');
const env = require('../util/env');
const Job = require('../models/job');
const db = require('../util/db');
const { ServiceError, ServerError } = require('../util/errors');

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
 * @returns {http.IncomingMessage} The service result
 * @throws {ServiceError} if the service call fails or returns an error
 */
async function _invokeImmediately(req) {
  const startTime = new Date().getTime();
  const { operation, logger } = req;
  const service = services.forOperation(operation, logger);
  const serviceResult = await service.invoke();
  const msTaken = new Date().getTime() - startTime;
  const { model } = service.operation;
  const spatialSubset = model.subset && Object.keys(model.subset).length > 0;
  // eslint-disable-next-line max-len
  const varSources = model.sources.filter((source) => source.variables && source.variables.length > 0);
  const variableSubset = varSources.length > 0;
  logger.info('Backend service request complete',
    { durationMs: msTaken,
      ...model,
      service: service.config.name,
      spatialSubset,
      variableSubset });
  return serviceResult;
}

/**
 * Creates a job to handle the request asynchronously.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @returns {Job} The job created for the request.
 */
async function _createJob(req) {
  req.logger.info(`Creating job for ${req.id}`);
  const message = req.truncationMessage;
  const job = new Job({
    username: req.operation.user,
    requestId: req.id,
    message,
  });
  try {
    await job.save(db);
  } catch (e) {
    req.logger.error(e.stack);
    throw new ServerError('Failed to save job to database.');
  }
  return job;
}

/**
 * Express.js handler which processes a request either synchronously or asynchronously.
 * For an asychronous request is creates a job and returns the job information back to the client.
 * For a synchronous request it calls the backend services, registering a URL for the backend to
 * POST to when complete, and returning to the client once the backend responds.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 * @throws {ServiceError} if the service call fails or returns an error
 * @throws {ServerError} if the job cannot be saved to the database
 */
async function serviceInvoker(req, res) {
  const { operation, user } = req;
  operation.user = user || 'anonymous';
  operation.client = env.harmonyClientId;

  if (operation.isSynchronous) {
    let serviceResult = null;
    try {
      serviceResult = await _invokeImmediately(req, res);
      translateServiceResult(serviceResult, res);
    } finally {
      if (serviceResult && serviceResult.onComplete) {
        serviceResult.onComplete();
      }
    }
  } else {
    const job = await _createJob(req, res);
    res.redirect(303, `/jobs/${job.requestId}`);
  }
}

module.exports = serviceInvoker;
