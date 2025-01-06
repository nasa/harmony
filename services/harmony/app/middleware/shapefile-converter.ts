/* eslint-disable @typescript-eslint/no-explicit-any */
import { get, isEqual, cloneDeep } from 'lodash';
import rewind from '@mapbox/geojson-rewind';
import * as togeojson from '@tmcw/togeojson';
import splitGeoJson from 'geojson-antimeridian-cut';
import * as turf from '@turf/turf';

import { DOMParser } from '@xmldom/xmldom';
import * as shpjs from 'shpjs';
import * as tmp from 'tmp-promise';

import { Logger } from 'winston';
import { NextFunction } from 'express';
import { promises as fs } from 'fs';
import { RequestValidationError, HttpError, ServerError } from '../util/errors';
import { defaultObjectStore } from '../util/object-store';
import { listToText } from '@harmony/util/string';
import { cookieOptions } from '../util/cookies';
import HarmonyRequest from '../models/harmony-request';
import { keysToLowerCase } from '../util/object';
import { point } from 'leaflet';

/**
 * Converts the given ESRI Shapefile to GeoJSON and returns the resulting file.   Note,
 * the caller MUST unlink the result to delete it
 *
 * @param filename - the path to the ESRI shapefile to convert (must be a .zip file)
 * @returns path to a temporary file containing the GeoJSON
 * @throws RequestValidationError - if something goes wrong
 */
async function _esriToGeoJson(filename: string): Promise<string> {
  let geoJsonFile;

  try {
    geoJsonFile = await tmp.file();
    const buffer = await fs.readFile(filename);
    const geojson = rewind(await shpjs.parseZip(buffer));
    await fs.writeFile(geoJsonFile.path, JSON.stringify(geojson), 'utf8');
  } catch (e) {
    if (geoJsonFile) await geoJsonFile.cleanup();
    if (e instanceof RequestValidationError) throw e;
    throw new RequestValidationError('The provided ESRI Shapefile file could not be parsed. Please check its validity before retrying.');
  }
  return geoJsonFile.path;
}

/**
 * Converts the given KML file to GeoJSON and returns the resulting file.   Note, the caller MUST
 * unlink the result to delete it
 *
 * @param filename - the path to the KML file to convert
 * @param logger - the logger to use for errors
 * @returns path to a temporary file containing the GeoJSON
 */
async function _kmlToGeoJson(filename: string, logger: Logger): Promise<string> {
  let geoJsonFile;
  try {
    geoJsonFile = await tmp.file();
    // TODO: would be better if we could find a way to avoid holding both kml and geojson in memory
    const parserOpts = {
      /**
       * locator is always need for error position info
       */
      locator: true,
      errorHandler: (_level, msg): void => {
        logger.error(msg);
        throw new RequestValidationError('The provided KML file could not be parsed. Please check its validity before retrying.');
      },
    };
    const file = await fs.readFile(filename, 'utf8');
    const kml = new DOMParser(parserOpts).parseFromString(file, '');
    const converted = togeojson.kml(kml as unknown as any);
    await fs.writeFile(geoJsonFile.path, JSON.stringify(converted), 'utf8');
  } catch (e) {
    if (geoJsonFile) geoJsonFile.cleanup();
    if (e instanceof RequestValidationError) throw e;
    logger.error(e);
    throw new RequestValidationError('The provided KML file could not be parsed. Please check its validity before retrying.');
  }

  return geoJsonFile.path;
}

const contentTypesToConverters = {
  'application/geo+json': { name: 'GeoJSON', geoJsonConverter: null },
  'application/vnd.google-earth.kml+xml': { name: 'KML', geoJsonConverter: _kmlToGeoJson },
  'application/shapefile+zip': { name: 'ESRI Shapefile', geoJsonConverter: _esriToGeoJson },
};

/**
 * Convert longitudes outside the [-180,180] range to [-180,180]
 * Note: this will only handle longitudes in the [-360,360] range
 * @param lon - longitude
 * @returns
 */
function normalizeLongitude(lon: number): number {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

/**
 * normalize all the longitudes in the file to [-180,180]
 * @param geojson - the object representing the geojson
 * @returns - the object with the normalized longitudes
 */
export function normalizeGeoJsonCoords(geojson: any): any {
  // eslint-disable-next-line require-jsdoc
  function normalizeCoordinates(coordinates: any): any {
    if (Array.isArray(coordinates[0])) {
      return coordinates.map(normalizeCoordinates);
    } else {
      return [normalizeLongitude(coordinates[0]), coordinates[1]];
    }
  }

  // eslint-disable-next-line require-jsdoc
  function normalizeGeometry(geometry: any): any {
    if (geometry.type === 'Point') {
      geometry.coordinates = normalizeCoordinates(geometry.coordinates);
    } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
      geometry.coordinates = geometry.coordinates.map(normalizeCoordinates);
    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
      geometry.coordinates = geometry.coordinates.map(ring => ring.map(normalizeCoordinates));
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates = geometry.coordinates.map(polygon => polygon.map(ring => ring.map(normalizeCoordinates)));
    } else if (geometry.type === 'GeometryCollection') {
      geometry.geometries = geometry.geometries.map(normalizeGeometry);
    }
    return geometry;
  }

  // eslint-disable-next-line require-jsdoc
  function normalizeFeature(feature: any): any {
    if (feature.type === 'Feature') {
      feature.geometry = normalizeGeometry(feature.geometry);
    } else if (feature.type === 'FeatureCollection') {
      feature.features = feature.features.map(normalizeFeature);
    }
    return feature;
  }

  return normalizeFeature(cloneDeep(geojson));
}

/**
 * Change longitudes of a geojson file to be in the [-180, 180] range and split at antimeridian
 * if needed. Will also change coordinate order to counter-clockwise if needed.
 * @param geoJson - An object representing the json for a geojson file
 * @parm simplifyShapefile - if true, reduce the point count of the shapefile - defaults to false
 * @returns An object with the normalized geojson
 */
export function normalizeGeoJson(geoJson: object, simplifyShapefile = false): object {
  let newGeoJson = normalizeGeoJsonCoords(geoJson);

  // eslint-disable-next-line @typescript-eslint/dot-notation
  for (const index in newGeoJson['features']) {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    const feature = newGeoJson['features'][index];
    const normalizedGeoJson = splitGeoJson(feature);
    // eslint-disable-next-line @typescript-eslint/dot-notation
    newGeoJson['features'][index] = normalizedGeoJson;
  }

  // force ccw winding
  newGeoJson = rewind(newGeoJson, false);

  if (simplifyShapefile) {
    let tolerance = 0.1;
    const highQuality = true;
    let pointCount = geoJsonPointCount(newGeoJson);
    console.log(`INITIAL POINT COUNT: ${pointCount}`);
    let loopCount = 0;
    // loop up to five times, or until the point count of the geojson is <= 5000
    // TODO put these constants (5, 5000) in env vars or some such
    while (loopCount < 5 && pointCount > 5000) {
      newGeoJson = turf.simplify(newGeoJson, { tolerance, highQuality });
      pointCount = geoJsonPointCount(newGeoJson);
      console.log(`POINT COUNT: ${pointCount}`);
      tolerance = tolerance * 10.0;
      loopCount++;
    }
    console.log(`FINAL POINT COUNT: ${pointCount}`);
  } else {
    console.log("NOT SIMPLIFYING SHAPEFILE");
  }
  console.log(`SHAPEFILE: ${JSON.stringify(newGeoJson, null, 2)}`);

  return newGeoJson;
}

/**
 * Handle any weird cases like splitting geometry that crosses the antimeridian
 * @param url - the url of the geojson file
 * @param isLocal - whether the url is a downloaded file (true) or needs to be downloaded (false)
 * @parm simplifyShapefile - if true, reduce the point count of the shapefile - defaults to false
 * @returns the link to the geojson file
 */
async function normalizeGeoJsonFile(url: string, isLocal: boolean, simplifyShapefle = false): Promise<string> {
  const store = defaultObjectStore();
  let originalGeoJson: object;
  const localFile = url;
  if (!isLocal) {
    originalGeoJson = await store.getObjectJson(url);
  } else {
    originalGeoJson = (await fs.readFile(localFile)).toJSON();
  }
  const normalizedGeoJson = normalizeGeoJson(originalGeoJson, simplifyShapefle);

  let resultUrl = url;

  if (!isEqual(originalGeoJson, normalizedGeoJson)) {
    resultUrl = `${url}-normalized.geojson`;
    await store.upload(JSON.stringify(normalizedGeoJson), resultUrl);
  }

  return resultUrl;
}

/**
 * Get the count of the points in a geojson file
 * @param geoJson A geojson object
 * @returns the number of points in the geojson file
 */
function geoJsonPointCount(geoJson: turf.AllGeoJSON): number {
  let pointCount = 0;
  turf.coordEach(geoJson, () => {
    pointCount += 1;
  });
  return pointCount;
}

/**
 * Express.js middleware which extracts shapefiles from the incoming request and
 * ensures that they are in GeoJSON in the data operation, optionally reducing the number
 * of points in the shapefile to fit the CMR limit (5000)
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function shapefileConverter(req: HarmonyRequest, res, next: NextFunction): Promise<void> {
  const { operation } = req;

  // TODO add proper handling/documentation of the simplifyShapefile parameter
  const lowerCaseQuery = keysToLowerCase(req.query);
  const lowerCaseBody = keysToLowerCase(req.body);
  const simplifyShapefile = lowerCaseQuery.simplifyshapefile || lowerCaseBody.simplifyshapefile;
  // const simplifyShapefile = true;

  try {
    const shapefile = get(req, 'files.shapefile[0]') || get(req, 'file') || req.signedCookies.shapefile;
    res.clearCookie('shapefile', cookieOptions);

    if (!shapefile) {
      next();
      return;
    }
    req.context.shapefile = shapefile;
    const store = defaultObjectStore();

    const { mimetype } = shapefile;
    const converter = contentTypesToConverters[mimetype];
    if (!converter) {
      const humanContentTypes = Object.entries(contentTypesToConverters).map(([k, v]) => `"${k}" (${v.name})`);
      throw new RequestValidationError(`Unrecognized shapefile type "${mimetype}".  Valid types are ${listToText(humanContentTypes)}`);
    }
    shapefile.typeName = converter.name;
    const url = store.getUrlString(shapefile);
    if (converter.geoJsonConverter) {
      const originalFile = await store.downloadFile(url);
      let convertedFile;
      try {
        convertedFile = await converter.geoJsonConverter(originalFile, req.context.logger);
        // TODO handle simplification for converted file
        operation.geojson = await store.uploadFile(convertedFile, `${url}.geojson`);
      } finally {
        if (convertedFile) {
          await fs.unlink(convertedFile);
        }
      }
    } else {
      console.log('NO NEED TO CONVERT GEOJSON');
      let geoJson = await normalizeGeoJsonFile(url, false, simplifyShapefile);


      operation.geojson = geoJson;
    }
  } catch (e) {
    if (e instanceof HttpError) {
      next(e);
      return;
    }
    req.context.logger.error(e);
    next(new ServerError('A problem occurred when attempting to convert the provided shapefile'));
    return;
  }
  next();
}
