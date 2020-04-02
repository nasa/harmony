const get = require('lodash.get');
const fs = require('fs');
const path = require('path');
const rewind = require('@mapbox/geojson-rewind');
const togeojson = require('@mapbox/togeojson');
const { DOMParser } = require('xmldom');
const esriShapefile = require('shapefile');
const tmp = require('tmp');
const util = require('util');
const unzipper = require('unzipper');
const { cookieOptions } = require('../util/cookies');
const { RequestValidationError } = require('../util/errors');
const { defaultObjectStore } = require('../util/object-store');
const { listToText } = require('../util/string');

const unlink = util.promisify(fs.unlink);

/**
 * The string that starts a GeoJSON file when converting from ESRI. We need to
 * use a FeatureCollection because we don't know if we will have one or many
 * features when streaming.
 */
const geoJsonFileStart = `{
  "type": "FeatureCollection",
  "features": [
`;

/**
 * The string that ends a GeoJSON file when converting from ESRI. This closes
 * the FeatureCollection
 */
const geoJsonFileEnd = ']}';

/**
 * Find a .shp file in a directory of files extracted from an ESRI shapefile .zip
 *
 * @param {*} dir The directory where the shapefile was extracted
 * @return {string} The path to the .shp file
 */
function findShpFile(dir) {
  const shpFiles = fs.readdirSync(dir).filter((file) => path.extname(file) === '.shp');
  if (shpFiles.length !== 1) {
    throw new RequestValidationError(
      `Error: shapefiles must contain exactly one .shp file, found ${shpFiles.length}`,
    );
  }

  return path.join(dir, shpFiles[0]);
}

/**
 * Converts the given ESRI Shapefile to GeoJSON and returns the resulting file.   Note,
 * the caller MUST unlink the result to delete it by calling `result.removeCallback()`
 *
 * @param {string} filename the path to the ESRI shapefile to convert (must be a .zip file)
 * @returns {string} path to a temporary file containing the GeoJSON
 * @throws {RequestValidationError} if something goes wrong
 * TODO:
 *   * enable tests with the ESRI format
 *   * write tests to make sure things get cleaned up,
 *   * write tests for error cases
 */
async function esriToGeoJson(filename) {
  const tempFile = tmp.fileSync();
  const tempDir = tmp.dirSync();
  // unzip the shapefile
  await fs.createReadStream(filename)
    .pipe(unzipper.Extract({ path: tempDir.name }))
    .promise()
    .catch((error) => {
      tempDir.removeCallback();
      throw new RequestValidationError(`Error: failed to unzip shapefile: ${error}`);
    });

  // convert to GeoJSON
  const shpFilePath = findShpFile(tempDir.name);
  fs.writeFileSync(tempFile.name, geoJsonFileStart, 'utf8');
  let firstLine = true;
  await esriShapefile.open(shpFilePath)
    .then((source) => source.read()
      .then(function log(result) {
        if (result.done) return;
        // Add commas between the Features
        if (firstLine) {
          firstLine = false;
        } else {
          fs.appendFileSync(tempFile.name, ',\n', 'utf8');
        }
        // set the correct winding on the outer and inner rings of polygons
        const feature = rewind(result.value, false);
        fs.appendFileSync(tempFile.name, JSON.stringify(feature), 'utf8');
        return source.read().then(log);
      }))
    .catch((error) => {
      tempDir.removeCallback();
      throw new RequestValidationError(`Error: failed to process shapefile: ${error}`);
    });
  fs.appendFileSync(tempFile.name, geoJsonFileEnd, 'utf8');
  tempDir.removeCallback();

  return tempFile.name;
}

/**
 * Converts the given KML file to GeoJSON and returns the resulting file.   Note, the caller MUST
 * unlink the result to delete it by calling `result.removeCallback()`
 *
 * @param {string} filename the path to the KML file to convert
 * @returns {string} path to a temporary file containing the GeoJSON
 */
async function kmlToGeoJson(filename) {
  const tempFile = tmp.fileSync();
  // TODO: would be better if we could find a way to avoid holding both kml and geojson in memory
  const kml = new DOMParser().parseFromString(fs.readFileSync(filename, 'utf8'));
  const converted = togeojson.kml(kml);
  fs.writeFileSync(tempFile.name, JSON.stringify(converted), 'utf8');

  return tempFile.name;
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
      operation.geojson = await store.uploadFile(convertedFile, `${url}.geojson`);
    } catch (e) {
      req.logger.error(e);
      throw new RequestValidationError('Unable to convert the provided shapefile');
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
