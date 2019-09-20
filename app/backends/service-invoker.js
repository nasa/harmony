const request = require('request');
const services = require('../models/services');

/**
 * Copies the header with the given name from the given request to the given response
 *
 * @param {http.IncomingMessage} req The request to copy from
 * @param {http.ServerResponse} res The response to copy to
 * @param {string} header The name of the header to set
 * @returns {undefined}
 */
function copyHeader(req, res, header) {
  res.set(header, req.get(header));
}

/**
 * Translates the given request sent by a backend service into the given
 * response sent to the client.
 *
 * @param {http.IncomingMessage} req The request sent by the backend
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {undefined}
 */
function translateServiceResponse(req, res) {
  for (const k of Object.keys(req.headers)) {
    if (k.startsWith('Harmony')) {
      copyHeader(req, res, k);
    }
  }
  const { query } = req;
  if (query.error) {
    res.status(400).send(query.error);
  } else if (query.redirect) {
    const result = request(query.redirect);
    result.pipe(res);
  } else {
    copyHeader(req, res, 'Content-Type');
    copyHeader(req, res, 'Content-Length');
    req.pipe(res);
  }
}

/**
 * Express.js handler that calls backend services, registering a URL for the backend
 * to POST to when complete.  Responds to the client once the backend responds.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<undefined>} Resolves when the request is complete
 */
async function serviceInvoker(req, res) {
  const service = services.forOperation(req.operation);
  const result = await service.invoke();

  translateServiceResponse(result.req, res);
  result.res.status(200);
  result.res.send('Ok');
}

module.exports = serviceInvoker;
