import { get } from 'lodash';
import rewind from '@mapbox/geojson-rewind';
import * as togeojson from '@tmcw/togeojson';

import { DOMParser } from 'xmldom';
import * as shpjs from 'shpjs';
import * as tmp from 'tmp-promise';

import { Logger } from 'winston';
import { NextFunction } from 'express';
import { RequestValidationError, HttpError, ServerError } from '../util/errors';
import { defaultObjectStore } from '../util/object-store';
import { listToText } from '../util/string';
import { cookieOptions } from '../util/cookies';
import { readFile, unlink, writeFile } from '../util/file';

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
    const buffer = await readFile(filename);
    const geojson = rewind(await shpjs.parseZip(buffer));
    await writeFile(geoJsonFile.path, JSON.stringify(geojson), 'utf8');
  } catch (e) {
    if (geoJsonFile) geoJsonFile.cleanup();
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
    const file = await readFile(filename, 'utf8');
    const kml = new DOMParser(parserOpts).parseFromString(file);
    const converted = togeojson.kml(kml);
    await writeFile(geoJsonFile.path, JSON.stringify(converted), 'utf8');
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
    const shapefile = get(req, 'files.shapefile[0]') || req.signedCookies.shapefile;
    res.clearCookie('shapefile', cookieOptions);

    if (!shapefile) {
      next();
      return;
    }
    req.context.shapefile = shapefile;
    const store = defaultObjectStore();

    const { mimetype, bucket, key } = shapefile;
    const converter = contentTypesToConverters[mimetype];
    if (!converter) {
      const humanContentTypes = Object.entries(contentTypesToConverters).map(([k, v]) => `"${k}" (${v.name})`);
      throw new RequestValidationError(`Unrecognized shapefile type "${mimetype}".  Valid types are ${listToText(humanContentTypes)}`);
    }
    shapefile.typeName = converter.name;
    const url = store.getUrlString(bucket, key);
    if (converter.geoJsonConverter) {
      const originalFile = await store.downloadFile(url);
      let convertedFile;
      try {
        convertedFile = await converter.geoJsonConverter(originalFile, req.context.logger);
        operation.geojson = await store.uploadFile(convertedFile, `${url}.geojson`);
      } finally {
        unlink(originalFile);
        if (convertedFile) {
          unlink(convertedFile);
        }
      }
    } else {
      operation.geojson = url;
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
