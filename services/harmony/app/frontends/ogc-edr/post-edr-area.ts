import { Response, NextFunction } from 'express';
import { mergeParameters } from '../../util/parameter-parsing-helpers';
import getDataForArea from './get-edr-area';
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
 */
export default function postDataForArea(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForArea(req, res, next);
}
