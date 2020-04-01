const get = require('lodash.get');
const fs = require('fs');
const tmp = require('tmp');
const util = require('util');
const { cookieOptions } = require('../util/cookies');
const { RequestValidationError } = require('../util/errors');
const { defaultObjectStore } = require('../util/object-store');
const { listToText } = require('../util/string');

const createTmpFile = util.promisify(tmp.file);
const unlink = util.promisify(fs.unlink);

/**
 * Converts the given ESRI Shapefile to GeoJSON and returns the resulting file.   Note,
 * the caller MUST unlink the result to delete it
 *
 * @param {string} filename the path to the ESRI shapefile to convert
 * @returns {string} path to a temporary file containing the GeoJSON
 */
async function esriToGeoJson(filename) {
  const tempFile = await createTmpFile();
  console.log('TODO: Implement esriToGeoJson, writing the result to tempFile');
  return tempFile;
}

/**
 * Converts the given KML file to GeoJSON and returns the resulting file.   Note, the caller MUST
 * unlink the result to delete it
 *
 * @param {string} filename the path to the KML file to convert
 * @returns {string} path to a temporary file containing the GeoJSON
 */
async function kmlToGeoJson(filename) {
  const tempFile = await createTmpFile();
  console.log('TODO: Implement kmlToGeoJson, writing the result to tempFile');
  return tempFile;
}

const contentTypesToConverters = {
  'application/geo+json': { name: 'GeoJSON', geoJsonConverter: null },
  'application/vnd.google-earth.kml+xml': { name: 'KML', geoJsonConverter: kmlToGeoJson },
  'application/shapefile+zip': { name: 'ESRI Shapefile', geoJsonConverter: esriToGeoJson },
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

  const shapefile = get(req, 'files.shapefile[0]') || req.signedCookies.shapefile;
  res.clearCookie('shapefile', cookieOptions);

  if (!shapefile) {
    next();
    return;
  }
  const store = defaultObjectStore();

  const { mimetype, bucket, key } = shapefile;
  const converter = contentTypesToConverters[mimetype];
  if (!converter) {
    const humanContentTypes = Object.entries(contentTypesToConverters).map(([k, v]) => `"${k}" (${v.name})`);
    throw new RequestValidationError(`Unrecognized shapefile type "${mimetype}".  Valid types are ${listToText(humanContentTypes)}`);
  }
  const url = store.getUrlString(bucket, key);
  if (converter.geoJsonConverter) {
    const originalFile = await store.downloadFile(url);
    let convertedFile;
    try {
      convertedFile = await converter.geoJsonConverter(originalFile);
      console.log('TODO: Uncomment setting operation.geojson after file conversion, once implemented');
      // operation.geojson = await store.uploadFile(`${url}.geojson`, convertedFile);
    } finally {
      unlink(originalFile);
      if (convertedFile) {
        unlink(convertedFile);
      }
    }
  } else {
    operation.geojson = url;
  }
  next();
}

module.exports = shapefileConverter;
