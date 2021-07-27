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
  // copy form parameters into the query
  req.query = { ...req.query, ...req.body };

  getCoverageRangeset(req, res, next);
}
