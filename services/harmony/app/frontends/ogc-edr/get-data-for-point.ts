import { NextFunction, Response } from 'express';

import HarmonyRequest from '../../models/harmony-request';
import env from '../../util/env';
import { RequestValidationError } from '../../util/errors';
import { keysToLowerCase } from '../../util/object';
import {
  mergeParameters, ParameterParseError, parseWkt, validateWkt,
} from '../../util/parameter-parsing-helpers';
import { getDataCommon } from './get-data-common';

/**
 * Converts a WKT POINT string to a WKT POLYGON string.
 * The polygon is a square centered around the point.
 *
 * Note this function is currently not being used because for HARMONY-2184 we're
 * changing to handle a single point the same way we handle parsing and passing
 * points to backend services as the coverages API. We may want to handle point
 * with a radius using this method in the future which is why we are keeping the
 * function.
 *
 * @param wktPoint - The WKT POINT string to convert.
 * @param sideLength - The length of the side of the square polygon.
 * @returns The converted WKT POLYGON string.
 * @throws RequestValidationError if the WKT POINT string format is invalid.
 */
function wktPointToPolygon(wktPoint: string, sideLength: number): string {
  validateWkt(wktPoint);
  const match = wktPoint.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
  if (!match) {
    throw new RequestValidationError(`query parameter "coords" invalid WKT POINT format: ${wktPoint}`);
  }

  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  const halfSide = sideLength / 2;

  const minx = x - halfSide;
  const miny = y - halfSide;
  const maxx = x + halfSide;
  const maxy = y + halfSide;

  return `POLYGON ((${minx} ${miny}, ${maxx} ${miny}, ${maxx} ${maxy}, ${minx} ${maxy}, ${minx} ${miny}))`;
}

/**
* Converts a WKT MULTIPOINT string to a WKT MULTIPOLYGON string.
* Each point is converted to a square polygon centered around the point.
*
* @param wktMultipoint - The WKT MULTIPOINT string to convert.
* @param sideLength - The length of the side of the square polygon.
* @returns The converted WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT MULTIPOINT string format is invalid.
*/
function wktMultipointToMultipolygon(wktMultipoint: string, sideLength: number): string {
  validateWkt(wktMultipoint);
  const match = wktMultipoint.match(/MULTIPOINT\s*\(\s*((?:\([-\d.]+\s+[-\d.]+\),?\s*)+)\s*\)/);
  if (!match) {
    throw new RequestValidationError(
      `query parameter "coords" invalid WKT MULTIPOINT format: ${wktMultipoint}`);
  }

  const pointsStr = match[1];
  const points = pointsStr.split(',').map(pointStr => {
    const cleanedPointStr = pointStr.replace(/[()]/g, '').trim();
    const [x, y] = cleanedPointStr.split(/\s+/).map(Number);
    return { x, y };
  });

  const halfSide = sideLength / 2;

  const polygons = points.map(({ x, y }) => {
    const minx = x - halfSide;
    const miny = y - halfSide;
    const maxx = x + halfSide;
    const maxy = y + halfSide;
    return `(${minx} ${miny}, ${maxx} ${miny}, ${maxx} ${maxy}, ${minx} ${maxy}, ${minx} ${miny})`;
  });

  return `MULTIPOLYGON (${polygons.map(polygon => `(${polygon})`).join(', ')})`;
}

/**
* Converts a WKT POINT or WKT MULTIPOINT string to a WKT POLYGON or WKT MULTIPOLYGON string.
*
* @param wkt - The WKT POINT or WKT MULTIPOINT string to convert.
* @param sideLength - The length of the side of each square polygon,
*                     defaults to 0.0001. It is about 11 meters in precision.
* @returns The converted WKT POLYGON or WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT string format is invalid.
*/
export function convertWktToPolygon(wkt: string, sideLength: number = env.wktPrecision): string {
  if (wkt.startsWith('POINT')) {
    return wktPointToPolygon(wkt, sideLength);
  } else if (wkt.startsWith('MULTIPOINT')) {
    return wktMultipointToMultipolygon(wkt, sideLength);
  } else {
    throw new RequestValidationError(`query parameter "coords" invalid WKT format: ${wkt}`);
  }
}

/**
 * Parses and validates the WKT POINT parameter string.
 *
 * @param wkt - The WKT POINT string to convert.
 *
 * @returns the parsed point in the form of [ Longitude, Latitude ]
 */
function parseWktPoint(wkt: string): [number, number] {
  validateWkt(wkt);
  const match = wkt.match(/POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)/);
  if (!match) {
    throw new RequestValidationError(`query parameter "coords" invalid WKT POINT format: ${wkt}`);
  }

  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);

  if (isNaN(x) || isNaN(y)) {
    throw new RequestValidationError(`query parameter "coords" invalid coordinate values in POINT: ${wkt}`);
  }
  return [x, y];
}

/**
 * Express middleware that responds to OGC API - EDR Position GET requests.
 * Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function getDataForPoint(
  req: HarmonyRequest,
  _res: Response,
  next: NextFunction,
): void {

  getDataCommon(req);
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  if (query.coords) {
    if (query.coords.startsWith('POINT')) {
      const point = parseWktPoint(query.coords);
      operation.spatialPoint = point;
    } else {
      try {
        const polygon = convertWktToPolygon(query.coords);

        const geoJson = parseWkt(polygon);
        if (geoJson) {
          operation.geojson = JSON.stringify(geoJson);
        }
      } catch (e) {
        if (e instanceof ParameterParseError) {
          // Turn parsing exceptions into 400 errors pinpointing the source parameter
          throw new RequestValidationError(`POINT/MULTIPOINT converted POLYGON/MULTIPOLYGON is invalid ${e.message}`);
        }
        throw e;
      }
    }
  }
  next();
}

/**
 * Express middleware that responds to OGC API - EDR Position POST requests.
 * Responds with the actual EDR data.
 *
 * This function merely sets up a query and proxies the request to the `getDataForPoint`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function postDataForPoint(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForPoint(req, res, next);
}
