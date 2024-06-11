import { keysToLowerCase } from '../../util/object';
import { ParameterParseError, mergeParameters, parseWkt } from '../../util/parameter-parsing-helpers';
import { Response, NextFunction } from 'express';
import HarmonyRequest from '../../models/harmony-request';
import { RequestValidationError } from '../../util/errors';
import { getDataCommon } from './get-data-common';

/**
 * Express middleware that responds to OGC API - EDR Area GET requests.
 * Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function getDataForArea(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {

  getDataCommon(req);
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  if (query.coords) {
    try {
      const geoJson = parseWkt(query.coords);
      if (geoJson) {
        operation.geojson = JSON.stringify(geoJson);
      }
    } catch (e) {
      if (e instanceof ParameterParseError) {
        // Turn parsing exceptions into 400 errors pinpointing the source parameter
        throw new RequestValidationError(`query parameter "coords" ${e.message}`);
      }
      throw e;
    }
  }

  next();
}

/**
 * Express middleware that responds to OGC API - EDR Area POST requests.
 * Responds with the actual EDR data.
 *
 * This function merely sets up a query and proxies the request to the `getDataForArea`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function postDataForArea(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForArea(req, res, next);
}
