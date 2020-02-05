/**
 * Middleware to add the requestId to the data operation.
 *
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 *
 */
function setRequestId(req, res, next) {
  const { operation } = req;

  if (!operation) return next();

  operation.requestId = req.id;
  return next();
}

module.exports = setRequestId;
