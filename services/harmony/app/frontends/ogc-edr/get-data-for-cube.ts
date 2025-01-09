import { NextFunction, Response } from 'express';
import HarmonyRequest from '../../models/harmony-request';
import { keysToLowerCase } from '../../util/object';
import { mergeParameters, ParameterParseError } from '../../util/parameter-parsing-helpers';
import { parseBbox } from './util/helper';
import { getDataCommon } from './get-data-common';
import { RequestValidationError } from '../../util/errors';

/**
 * Express middleware that responds to OGC API - EDR cube requests.
 * Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export function getDataForCube(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  getDataCommon(req);
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  try {
    const bbox = parseBbox(query.bbox as string);
    if (bbox) {
      operation.boundingRectangle = bbox;
    }
    next();
  } catch (e) {
    if (e instanceof ParameterParseError) {
      throw new RequestValidationError(e.message);
    }
    throw e;
  }
}

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
export function postDataForCube(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForCube(req, res, next);
}