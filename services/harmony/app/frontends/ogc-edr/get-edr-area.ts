import { NextFunction, Response } from 'express';
import HarmonyRequest from '../../models/harmony-request';
import { getRequestOperation } from '../ogc-coverages/get-coverage-rangeset';
/**
 * Express middleware that responds to OGC API - EDR
 * rangeset requests.  Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function getDataForArea(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  req.context.frontend = 'ogcEdr';
  // set variable indicator to parameter_vars to indicate that variables have to be provided as query params
  req.params.collectionId = 'parameter_vars';
  getRequestOperation(req, res, next);
}


