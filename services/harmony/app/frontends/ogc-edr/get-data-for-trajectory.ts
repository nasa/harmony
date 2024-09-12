import { keysToLowerCase } from '../../util/object';
import { ParameterParseError, mergeParameters, parseWkt, validateWkt } from '../../util/parameter-parsing-helpers';
import { Response, NextFunction } from 'express';
import HarmonyRequest from '../../models/harmony-request';
import { ServerError, RequestValidationError } from '../../util/errors';
import { getDataCommon } from './get-data-common';

// LINESTRING to POLYGON conversion side length, 0.0001 is about 11 meters in precision
const LINESTRING_PRECISION = 0.0001;

/**
 * Converts a WKT LineString string to a WKT POLYGON string.
 * The polygon is a narrow rectangle centered around the line.
 *
 * @param wktLineString - The WKT LineString string to convert.
 * @param sideLength - The length of the side of the square polygon.
 * @returns The converted WKT POLYGON string.
 * @throws RequestValidationError if the WKT POINT string format is invalid.
 */
function wktLineStringToPolygon(wktLineString: string, sideLength: number): string {
  validateWkt(wktLineString);
  const match = wktLineString.match(/LINESTRING\s*\((.*)\)/);
  if (!match) {
    throw new RequestValidationError(`query parameter "coords" invalid WKT LINESTRING format: ${wktLineString}`);
  }

  const coordinates = match[1].trim();
  const points = coordinates.split(',').map(coord => {
    const [x, y] = coord.trim().split(/\s+/).map(Number);
    return { x, y };
  });

  console.log(`==========points: ${JSON.stringify(points)}`);

  // Check if there are at least two points
  if (points.length < 2) {
    throw new Error('LineString must contain at least two points');
  }

  const halfSide = sideLength / 2;

  // Create a buffer around the LineString
  const leftBuffer: Array<{ x: number; y: number }> = [];
  const rightBuffer: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // Calculate the direction vector between p1 and p2
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Normalize the direction vector to get the perpendicular vector
    const unitDx = dx / length;
    const unitDy = dy / length;

    // Perpendicular vectors to the left and right
    const perpLeft = { x: -unitDy, y: unitDx };
    const perpRight = { x: unitDy, y: -unitDx };

    // Create points to the left and right of p1 and p2
    leftBuffer.push({
      x: p1.x + perpLeft.x * halfSide,
      y: p1.y + perpLeft.y * halfSide,
    });
    rightBuffer.unshift({
      x: p1.x + perpRight.x * halfSide,
      y: p1.y + perpRight.y * halfSide,
    });

    if (i === points.length - 2) {
      leftBuffer.push({
        x: p2.x + perpLeft.x * halfSide,
        y: p2.y + perpLeft.y * halfSide,
      });
      rightBuffer.unshift({
        x: p2.x + perpRight.x * halfSide,
        y: p2.y + perpRight.y * halfSide,
      });
    }
  }
  console.log(`==========leftBuffer: ${JSON.stringify(leftBuffer)}`);
  console.log(`==========rightBuffer: ${JSON.stringify(rightBuffer)}`);
  console.log(`==========all: ${JSON.stringify([...leftBuffer, ...rightBuffer])}`);

  // Combine left and right buffers to form the polygon
  const polygonPoints = [...leftBuffer, ...rightBuffer, leftBuffer[0]].map(p => `${p.x} ${p.y}`).join(', ');

  return `POLYGON ((${polygonPoints}))`;
}

/**
 * Removes unnecessary spaces between LineStrings in a WKT MultiLineString.
 *
 * @param wktMultiLineString - The WKT MultiLineString to process.
 * @returns The WKT MultiLineString with the spaces removed.
 */
function cleanMultiLineString(wktMultiLineString: string): string {
  // Use regex to remove spaces after each comma between LineStrings
  return wktMultiLineString.replace(/\),\s*\(/g, '),(');
}

/**
* Converts a WKT MultiLineString to a WKT MultiPolygon by creating a buffer around each LineString.
*
* @param wktMultiLineString - The WKT MultiLineString string to convert.
* @param sideLength - The buffer distance (side length) to create around each LineString.
* @returns The converted WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT MULTIPOINT string format is invalid.
*/
function wktMultiLineStringToMultipolygon(
  wktMultiLineString: string,
  sideLength: number): string {
  validateWkt(wktMultiLineString);
  const match = wktMultiLineString.match(/MULTILINESTRING\s*\(\((.*)\)\)/);
  if (!match) {
    throw new RequestValidationError(
      `query parameter "coords" invalid WKT MULTIPOINT format: ${wktMultiLineString}`);
  }

  const multiLS = cleanMultiLineString(match[1]);

  const lineStrings = multiLS.split('),(').map(lineStr => lineStr.trim());

  const polygons: string[] = lineStrings.map(lineStr => {
    const points = lineStr.split(',').map(coord => {
      const [x, y] = coord.trim().split(/\s+/).map(Number);
      return { x, y };
    });

    if (points.length < 2) {
      throw new Error('Each LineString must contain at least two points');
    }

    const halfSide = sideLength / 2;

    const leftBuffer: Array<{ x: number; y: number }> = [];
    const rightBuffer: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      const unitDx = dx / length;
      const unitDy = dy / length;

      const perpLeft = { x: -unitDy, y: unitDx };
      const perpRight = { x: unitDy, y: -unitDx };

      leftBuffer.push({
        x: p1.x + perpLeft.x * halfSide,
        y: p1.y + perpLeft.y * halfSide,
      });
      rightBuffer.unshift({
        x: p1.x + perpRight.x * halfSide,
        y: p1.y + perpRight.y * halfSide,
      });

      if (i === points.length - 2) {
        leftBuffer.push({
          x: p2.x + perpLeft.x * halfSide,
          y: p2.y + perpLeft.y * halfSide,
        });
        rightBuffer.unshift({
          x: p2.x + perpRight.x * halfSide,
          y: p2.y + perpRight.y * halfSide,
        });
      }
    }

    const polygonPoints = [...leftBuffer, ...rightBuffer, leftBuffer[0]].map(
      p => `${p.x} ${p.y}`).join(', ');

    return `((${polygonPoints}))`;
  });

  return `MULTIPOLYGON (${polygons.join(', ')})`;
}

/**
* Converts a WKT LINESTRING or WKT MULTILINESTRING string to a WKT POLYGON or WKT MULTIPOLYGON string.
*
* @param wkt - The WKT LINESTRING or WKT MULTILINESTRING string to convert.
* @param sideLength - The length of the side of each square polygon,
*                     defaults to 0.0001. It is about 11 meters in precision.
* @returns The converted WKT POLYGON or WKT MULTIPOLYGON string.
* @throws RequestValidationError if the WKT string format is invalid.
*/
export function convertWktLineToPolygon(
  wkt: string,
  sideLength: number = LINESTRING_PRECISION): string {
  if (wkt.startsWith('LINESTRING')) {
    return wktLineStringToPolygon(wkt, sideLength);
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
        throw new ServerError(`POINT/MULTIPOINT coverted POLYGON/MULTIPOLYGON is invalid ${e.message}`);
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
