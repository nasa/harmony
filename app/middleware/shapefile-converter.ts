const get = require('lodash.get');
const fs = require('fs');
const rewind = require('@mapbox/geojson-rewind');
const togeojson = require('@mapbox/togeojson');
const { DOMParser } = require('xmldom');
const shpjs = require('shpjs');
const tmp = require('tmp-promise');
const util = require('util');
const { cookieOptions } = require('../util/cookies');
const { RequestValidationError, HttpError, ServerError } = require('../util/errors');
const { defaultObjectStore } = require('../util/object-store');
const { listToText } = require('../util/string');

const unlink = util.promisify(fs.unlink);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

/**
 * Converts the given ESRI Shapefile to GeoJSON and returns the resulting file.   Note,
 * the caller MUST unlink the result to delete it
 *
 * @param {string} filename the path to the ESRI shapefile to convert (must be a .zip file)
 * @returns {string} path to a temporary file containing the GeoJSON
 * @throws {RequestValidationError} if something goes wrong
 */
async function _esriToGeoJson(filename) {
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
 * @param {string} filename the path to the KML file to convert
 * @param {Logger} logger the logger to use for errors
 * @returns {string} path to a temporary file containing the GeoJSON
 */
async function _kmlToGeoJson(filename, logger) {
  let geoJsonFile;
  try {
    geoJsonFile = await tmp.file();
    // TODO: would be better if we could find a way to avoid holding both kml and geojson in memory
    const parserOpts = {
      /**
       * locator is always need for error position info
       */
      locator: {},
      errorHandler: (_level, msg) => {
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
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 */
async function shapefileConverter(req, res, next) {
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

module.exports = shapefileConverter;
