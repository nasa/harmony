import { ServerResponse } from 'http';
import { NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getGridsByName } from './cmr';
import parseCRS from './crs';
import { RequestValidationError } from './errors';
import { keysToLowerCase } from './object';

/**
 * Throws an error if the grid name parameter is included along with regridding parameters.
 *
 * @param query - the query for the request
 * @throws RequestValidationError if the combination of parameters is invalid.
*/
export function validateNoConflictingGridParameters(query: Record<string, unknown>): void {
  const keys = keysToLowerCase(query);
  if (keys.grid) {
    if (keys.outputcrs || keys.scaleextent || keys.scalesize || keys.width || keys.height) {
      throw new RequestValidationError('When including a grid query parameter, the following parameters may not be provided: scaleExtent, scaleSize, outputCrs, height, and width.');
    }
  }
}

/**
 * Middleware to handle the grid parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 * @throws RequestValidationError if the combination of parameters is invalid or no grid can be found matching the grid name.
 */
export async function parseGridMiddleware(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
) : Promise<void> {
  const { operation } = req;
  if (!operation) return next();
  const query = keysToLowerCase(req.query);

  if (query.grid) {
    try {
      validateNoConflictingGridParameters(query);
      const gridName = query.grid;
      const grids = await getGridsByName(gridName, req.accessToken );
      if (grids.length > 1) {
        req.context.logger.warn(`Multiple grids returned for name ${gridName}, choosing the first one returned by CMR.`);
      } else if (grids.length == 0) {
        throw new RequestValidationError(`Unknown grid ${gridName}`);
      }
      const gridInfo = grids[0].umm.GridDefinition;
      const [crs, srs] = parseCRS(gridInfo.CoordinateReferenceSystemID.Code);
      operation.crs = crs;
      operation.srs = srs;
      operation.scaleExtent = {
        x: { min: gridInfo.DimensionScale.X.Minimum, max: gridInfo.DimensionScale.X.Maximum },
        y: { min: gridInfo.DimensionScale.Y.Minimum, max: gridInfo.DimensionScale.Y.Maximum },
      };
      operation.outputWidth = gridInfo.DimensionSize.Width;
      operation.outputHeight = gridInfo.DimensionSize.Height;
      operation.scaleSize = {
        x: gridInfo.DimensionScale.X.Resolution,
        y: gridInfo.DimensionScale.Y.Resolution,
      };
    } catch (e) {
      next(e);
    }
  }
  return next();
}