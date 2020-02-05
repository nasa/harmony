const env = require('../util/env');

/**
 * Determines if a request should be handled synchronously or asynchronously.
 * Updates the request to set the request mode accordingly.
 *
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 *
 */
function syncRequestDecider(req, res, next) {
  const { operation } = req;

  if (!operation) return next();

  const granules = operation.sources.flatMap((source) => source.granules);
  req.synchronousRequest = (granules.length <= env.maxSynchronousGranules);

  return next();
}

module.exports = syncRequestDecider;
