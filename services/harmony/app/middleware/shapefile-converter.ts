/* eslint-disable require-jsdoc */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { get } from 'lodash';
import rewind from '@mapbox/geojson-rewind';
import * as togeojson from '@tmcw/togeojson';
import splitGeoJson from 'geojson-antimeridian-cut';

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
      locator: {},
      errorHandler: (_level, msg): void => {
        logger.error(msg);
        throw new RequestValidationError('The provided KML file could not be parsed. Please check its validity before retrying.');
      },
    };
    const file = await fs.readFile(filename, 'utf8');
    const kml = new DOMParser(parserOpts).parseFromString(file);
    const converted = togeojson.kml(kml);
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
 *
 * @param lon - longitude
 * @returns
 */
function normalizeLongitude(lon: number): number {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

/**
 *
 * @param geojson - normalize all the longitudes in the file to [-180,180]
 * @returns
 */
export function normalizeGeoJsonCoords(geojson: any): any {
  function normalizeCoordinates(coordinates: any): any {
    if (Array.isArray(coordinates[0])) {
      return coordinates.map(normalizeCoordinates);
    } else {
      return [normalizeLongitude(coordinates[0]), coordinates[1]];
    }
  }

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

  function normalizeFeature(feature: any): any {
    if (feature.type === 'Feature') {
      feature.geometry = normalizeGeometry(feature.geometry);
    } else if (feature.type === 'FeatureCollection') {
      feature.features = feature.features.map(normalizeFeature);
    }
    return feature;
  }

  return normalizeFeature(geojson);
}

/**
 * Change longitudes of a geojson file to be in the [-180, 180] range and split at antimeridian
 * if needed
 * @param geoJson - An object representing the json for a geojson file
 * @returns A string with the normalized geojson
 */
export function normalizeGeoJson(geoJson: object): string {
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
  return newGeoJson;

}

/**
 * Handle any weird cases like splitting geometry that crosses the antimeridian
 * @param url - the url of the geojson file
 * @param isLocal - whether the url is a downloaded file (true) or needs to be downloaded (false)
 */
async function normalizeGeoJsonFile(url: string, isLocal: boolean, logger: Logger): Promise<string> {
  logger.debug('Normalizing geojson');
  const store = defaultObjectStore();
  let originalGeoJson: object;
  const localFile = url;
  if (!isLocal) {
    originalGeoJson = await store.getObjectJson(url);
  } else {
    originalGeoJson = (await fs.readFile(localFile)).toJSON();
  }
  const normalizedGeoJson = normalizeGeoJson(originalGeoJson);

  // Uncomment this line to save the normalized file locally during development
  // await fs.writeFile('normalized.geojson', JSON.stringify(normalizedGeoJson));

  const uploadUrl = `${url}-normalized.geojson`;
  await store.upload(JSON.stringify(normalizedGeoJson), uploadUrl);

  return uploadUrl;
}

/**
 * Express.js middleware which extracts shapefiles from the incoming request and
 * ensures that they are in GeoJSON in the data operation
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function shapefileConverter(req, res, next: NextFunction): Promise<void> {
  const { operation } = req;

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
        operation.geojson = await store.uploadFile(convertedFile, `${url}.geojson`);
      } finally {
        if (convertedFile) {
          await fs.unlink(convertedFile);
        }
      }
    } else {
      operation.geojson = await normalizeGeoJsonFile(url, false, req.context.logger);
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
