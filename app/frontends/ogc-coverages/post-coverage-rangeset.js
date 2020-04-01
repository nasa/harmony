const getCoverageRangeset = require('./get-coverage-rangeset');

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset POST requests.  Responds with the actual coverage data.
 *
 * This function merely sets up a query and proxies the request to the `getCoverageRangeset`
 * function.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {function} next The next express handler
 * @returns {void}
 * @throws {RequestValidationError} Thrown if the request has validation problems and
 *   cannot be performed
 */
function postCoverageRangeset(req, res, next) {
  // copy form parameters into the query
  req.query = req.body;

  getCoverageRangeset(req, res, next);
}

module.exports = postCoverageRangeset;
