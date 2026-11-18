import { earthRadius } from '@turf/helpers';
import { NextFunction, Response } from 'express';
import wellknown from 'wellknown';

import { getDataCommon } from './get-data-common';
import { normalizeGeoJson } from '../../middleware/shapefile-converter';
import HarmonyRequest from '../../models/harmony-request';
import { RequestValidationError } from '../../util/errors';
import { keysToLowerCase } from '../../util/object';
import { mergeParameters, validateWkt } from '../../util/parameter-parsing-helpers';
import { hashGeoJson } from '../../util/request-checksum';

// Supported values for the within-units parameter mapped to the number of meters per unit
export const withinUnitsToMeters = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
};

const METERS_PER_DEGREE_OF_LATITUDE = (Math.PI * earthRadius) / 180;

/**
 * Parses and validates the within and within-units parameters and returns the radius in meters.
 *
 * @param within - The radius around the coordinates
 * @param withinUnits - The distance units for the radius, e.g. km
 * @returns The radius in meters
 * @throws RequestValidationError if the parameters are missing or invalid
 */
export function parseRadius(within: string | number, withinUnits: string): number {
  if (within === undefined || within === null || within === '') {
    throw new RequestValidationError('query parameter "within" is required');
  }
  const radius = Number(within);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RequestValidationError(`query parameter "within" must be a positive number, but was: ${within}`);
  }
  if (!withinUnits) {
    throw new RequestValidationError('query parameter "within-units" is required');
  }
  const metersPerUnit = withinUnitsToMeters[withinUnits.toLowerCase()];
  if (!metersPerUnit) {
    const allowedUnits = Object.keys(withinUnitsToMeters).join(', ');
    throw new RequestValidationError(
      `query parameter "within-units" must be one of ${allowedUnits}, but was: ${withinUnits}`);
  }
  return radius * metersPerUnit;
}

/**
 * Converts a WKT POINT or MULTIPOINT string to a normalized GeoJSON FeatureCollection with a
 * polygon approximating a circle of the given radius around each point.
 *
 * @param wkt - The WKT POINT or MULTIPOINT string to convert
 * @param radius - The radius of the circle around each point in meters
 * @returns The normalized GeoJSON FeatureCollection
 * @throws RequestValidationError if the WKT string is invalid or a circle would contain a pole
 */
export function convertWktToCircles(wkt: string, radius: number): object {
  validateWkt(wkt);
  const geometry = wellknown.parse(wkt);
  if (geometry.type !== 'Point' && geometry.type !== 'MultiPoint') {
    throw new RequestValidationError(`query parameter "coords" must be a WKT POINT or MULTIPOINT: ${wkt}`);
  }

  const points: number[][] = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
  for (const [lon, lat] of points) {
    if (lat < -90 || lat > 90 || lon < -360 || lon > 360) {
      throw new RequestValidationError(`query parameter "coords" has invalid coordinates (${lon} ${lat}): ${wkt}`);
    }
    // circles containing a pole cannot be represented as a polygon in longitude/latitude
    if (radius >= (90 - Math.abs(lat)) * METERS_PER_DEGREE_OF_LATITUDE) {
      throw new RequestValidationError(
        `the area within the requested radius of (${lon} ${lat}) contains a pole, which is not supported`);
    }
  }

  // the radius (in meters) is read from the feature properties when converting points to polygons
  return normalizeGeoJson({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry, properties: { radius } }],
  });
}

/**
 * Express middleware that responds to OGC API - EDR Radius GET requests.
 * Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param _res - The response to send to the client
 * @param next - The next express handler
 */
export function getDataForRadius(
  req: HarmonyRequest,
  _res: Response,
  next: NextFunction,
): void {
  getDataCommon(req);
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  const radius = parseRadius(query.within, query['within-units']);
  if (query.coords) {
    const geoJson = convertWktToCircles(query.coords, radius);
    operation.geojson = JSON.stringify(geoJson);
    req.context.spatialHash = hashGeoJson(geoJson);
  }

  next();
}

/**
 * Express middleware that responds to OGC API - EDR Radius POST requests.
 * Responds with the actual EDR data.
 *
 * This function merely sets up a query and proxies the request to the `getDataForRadius`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function postDataForRadius(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForRadius(req, res, next);
}
