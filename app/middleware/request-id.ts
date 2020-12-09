/**
 * Middleware to add the requestId to the data operation.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 *
 */
export default function setRequestId(req, res, next): void {
  const { operation } = req;

  if (!operation) return next();

  operation.requestId = req.context.id;
  return next();
}
