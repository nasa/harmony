const env = require('../util/env');
const Job = require('../models/job');
const db = require('../util/db');

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

  // Save job information to the database for an asynchronous request
  if (operation.isSynchronous === false) {
    const job = new Job({
      username: (req.user || 'unknown'),
      requestId: req.id,
    });
    job.save(db);
  }

  return next();
}

module.exports = syncRequestDecider;
