import { Response, NextFunction } from 'express';
import getCoverageRangeset from './get-coverage-rangeset';
import HarmonyRequest from '../../models/harmony-request';

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset POST requests.  Responds with the actual coverage data.
 *
 * This function merely sets up a query and proxies the request to the `getCoverageRangeset`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function postCoverageRangeset(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  let queryKeys = Object.keys(req.query);
  let bodyKeys = Object.keys(req.body);
  if (queryKeys.filter(x => bodyKeys.includes(x)).length) {
    console.log("Duplicate keys found from request body and query string. We Will use that from request body.");
  }
  req.query = { ...req.query, ...req.body };

  getCoverageRangeset(req, res, next);
}
