const services = require('../models/services');

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
 */
function translateServiceResult(serviceResult, res) {
  for (const k of Object.keys(serviceResult.headers)) {
    if (k.toLowerCase().startsWith('harmony')) {
      copyHeader(serviceResult, res, k);
    }
  }
  if (serviceResult.error) {
    res.status(serviceResult.statusCode || 400).send(serviceResult.error);
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
 */
async function serviceInvoker(req, res) {
  req.operation.user = req.user || 'anonymous';
  const service = services.forOperation(req.operation, req.logger);
  const serviceResult = await service.invoke();
  translateServiceResult(serviceResult, res);
  if (serviceResult.onComplete) {
    serviceResult.onComplete();
  }
}

module.exports = serviceInvoker;
