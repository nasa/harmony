import { keysToLowerCase } from '../../util/object';
import { ParameterParseError, mergeParameters, parseWkt, validateWkt } from '../../util/parameter-parsing-helpers';
import { Response, NextFunction } from 'express';
import HarmonyRequest from '../../models/harmony-request';
import { ServerError, RequestValidationError } from '../../util/errors';
import { getDataCommon } from './get-data-common';

// LINESTRING to POLYGON conversion side length, 0.0001 is about 11 meters in precision
const LINESTRING_PRECISION = 0.0001;

type Point = { x: number, y: number };

/**
 * Converts a two-point segment (line) into a polygon with a buffer.
 * This function does not ensure that the polygon points are in counter-clockwise order
 * because the converted polygons will eventually be normalized in parseWkt function
 * to make sure the generated GeoJSON has the correct coordinates order and is splitted
 * across the antimeridian.
 *
 * @param segment - The two points defining the line segment.
 * @param sideLength - The buffer distance (side length) to create around the segment.
 * @returns The vertices of the polygon.
 */
function convertSegmentToPolygon(segment: [Point, Point], sideLength: number): Point[] {
  const [p1, p2] = segment;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  const unitDx = dx / length;
  const unitDy = dy / length;

  const perpLeft = { x: -unitDy, y: unitDx };
  const perpRight = { x: unitDy, y: -unitDx };

  const halfSide = sideLength / 2;

  const leftBuffer = [
    { x: p1.x + perpLeft.x * halfSide, y: p1.y + perpLeft.y * halfSide },
    { x: p2.x + perpLeft.x * halfSide, y: p2.y + perpLeft.y * halfSide },
  ];

  const rightBuffer = [
    { x: p1.x + perpRight.x * halfSide, y: p1.y + perpRight.y * halfSide },
    { x: p2.x + perpRight.x * halfSide, y: p2.y + perpRight.y * halfSide },
  ];

  // Close the polygon
  const polygonPoints = [...leftBuffer, ...rightBuffer.reverse(), leftBuffer[0]];

  return polygonPoints;
}

/**
* Converts a WKT LineString coords part into a list of polygons by splitting the LineString into
* two-point segments and converting each segment into a polygon.
*
* @param wktLineCoords - The WKT LineString coords part in string to convert.
* @param sideLength - The buffer distance (side length) to create around each segment.
* @returns The WKT Polygon coords part in string.
* @throws RequestValidationError - If the input does not have at least two points.
*/
function convertLineStringCoordsToPolygons(wktLineCoords: string, sideLength: number): string[] {
  const points = wktLineCoords.split(',').map(coord => {
    const [x, y] = coord.trim().split(/\s+/).map(Number);
    return { x, y };
  });

  if (points.length < 2) {
    throw new Error('LineString must contain at least two points');
  }

  const polygons: string[] = [];

  // Loop through consecutive points to create line segments
  for (let i = 0; i < points.length - 1; i++) {
    const segment: [Point, Point] = [points[i], points[i + 1]];

    // Convert each segment into a polygon
    const polygonPoints = convertSegmentToPolygon(segment, sideLength);

    // Convert polygon points to WKT format
    const polygonString = polygonPoints.map(p => `${p.x} ${p.y}`).join(', ');

    polygons.push(`((${polygonString}))`);
  }

  return polygons;
}

/**
* Converts a WKT LINESTRING into a WKT POLYGON/MULTIPOLYGON by splitting the LINESTRING into
* two-point segments and converting each segment into a polygon.
*
* @param wktLineString - The WKT LINESTRING to convert.
* @param sideLength - The buffer distance (side length) to create around each segment.
* @returns The WKT POLYGON/MULTIPOLYGON string with points for each polygon.
* @throws RequestValidationError - If the input is not a valid WKT LINESTRING.
*/
function convertLineStringToPolygon(wktLineString: string, sideLength: number): string {
  validateWkt(wktLineString);
  const match = wktLineString.match(/LINESTRING\s*\((.*)\)/);
  if (!match) {
    throw new RequestValidationError(`query parameter "coords" invalid WKT LINESTRING format: ${wktLineString}`);
  }

  const polygons = convertLineStringCoordsToPolygons(match[1], sideLength);

  let wktPolygon = '';
  if (polygons.length > 1) {
    wktPolygon = `MULTIPOLYGON (${polygons.join(', ')})`;
  } else {
    wktPolygon = `POLYGON ${polygons.join(', ')}`;
  }

  return wktPolygon;
}

/**
* Converts a WKT MULTILINESTRING to a WKT MULTIPOLYGON by creating a buffer around each LineString.
*
* @param wktMultiLineString - The WKT MULTILINESTRING string to convert.
* @param sideLength - The buffer distance (side length) to create around each LineString.
* @returns The converted WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT MULTILINESTRING string format is invalid.
*/
function wktMultiLineStringToMultipolygon(
  wktMultiLineString: string,
  sideLength: number): string {

  validateWkt(wktMultiLineString);
  const match = wktMultiLineString.match(/MULTILINESTRING\s*\(\((.*)\)\)/);
  if (!match) {
    throw new RequestValidationError(
      `query parameter "coords" invalid WKT MULTILINESTRING format: ${wktMultiLineString}`);
  }

  const multiLS = match[1].replace(/\),\s*\(/g, '),(');

  const lineStrings = multiLS.split('),(').map(lineStr => lineStr.trim());

  let polygons: string[] = [];

  // Convert each LineString to MultiPolygon and add to result
  lineStrings.forEach(lineString => {
    const linePolygons = convertLineStringCoordsToPolygons(lineString, sideLength);
    polygons = polygons.concat(linePolygons);
  });

  return `MULTIPOLYGON (${polygons.join(', ')})`;
}

/**
* Converts a WKT LINESTRING/MULTILINESTRING string to a WKT POLYGON/MULTIPOLYGON string.
*
* @param wkt - The WKT LINESTRING or WKT MULTILINESTRING string to convert.
* @param sideLength - The length of the side around each endpoint of the line,
*                     defaults to 0.0001. It is about 11 meters in precision.
* @returns The converted WKT POLYGON or WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT string format is invalid.
*/
export function convertWktLineToPolygon(
  wkt: string,
  sideLength: number = LINESTRING_PRECISION): string {

  if (wkt.startsWith('LINESTRING')) {
    return convertLineStringToPolygon(wkt, sideLength);
  } else if (wkt.startsWith('MULTILINESTRING')) {
    return wktMultiLineStringToMultipolygon(wkt, sideLength);
  } else {
    throw new RequestValidationError(`query parameter "coords" invalid WKT format: ${wkt}`);
  }
}

/**
 * Express middleware that responds to OGC API - EDR Trajectory GET requests.
 * Responds with the actual EDR data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function getDataForTrajectory(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {

  getDataCommon(req);
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  if (query.coords) {
    const polygon = convertWktLineToPolygon(query.coords);
    try {
      const geoJson = parseWkt(polygon);
      if (geoJson) {
        operation.geojson = JSON.stringify(geoJson);
      }
    } catch (e) {
      if (e instanceof ParameterParseError) {
        // Turn parsing exceptions into 400 errors pinpointing the source parameter
        throw new ServerError(`LINESTRING/MULTILINESTRING coverted POLYGON/MULTIPOLYGON is invalid ${e.message}`);
      }
      throw e;
    }
  }

  next();
}

/**
 * Express middleware that responds to OGC API - EDR Trajectory POST requests.
 * Responds with the actual EDR data.
 *
 * This function merely sets up a query and proxies the request to the `getDataForPoint`
 * function.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 */
export function postDataForTrajectory(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  // merge form parameters into the query
  mergeParameters(req);

  getDataForTrajectory(req, res, next);
}
