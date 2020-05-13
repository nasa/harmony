/**
 * Middleware to add the requestId to the data operation.
 *
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {Function} next The next function in the middleware chain
 * @returns {void}
 *
 */
export default function setRequestId(req, res, next): void {
  const { operation } = req;

  if (!operation) return next();

  operation.requestId = req.context.id;
  return next();
}
