const env = require('../util/env');

/**
 * Determines if a request should be handled synchronously or asynchronously.
 * Updates the request to set the request mode accordingly. Middleware must be
 * called after the source granules have already been added to the operation.
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

  if (operation.isSynchronous === undefined) {
    const granules = operation.sources.flatMap((source) => source.granules);
    operation.isSynchronous = (granules.length <= env.maxSynchronousGranules);
  }
  return next();
}

module.exports = syncRequestDecider;
