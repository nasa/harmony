import { Response, NextFunction } from 'express';
import { mergeParameters } from '../../util/parameter-parsing-helpers';
import getDataForCube from './get-data-for-cube';
import HarmonyRequest from '../../models/harmony-request';

/**
 * Express middleware that responds to OGC API - EDR POST requests.
 * Responds with the actual EDR data.
 *
 * This function merely sets up a query and proxies the request to the `getDataForCube`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export default function postDataForCube(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForCube(req, res, next);
}
