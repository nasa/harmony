const get = require('lodash.get');
const fs = require('fs');
const path = require('path');
const rewind = require('@mapbox/geojson-rewind');
const togeojson = require('@mapbox/togeojson');
const { DOMParser } = require('xmldom');
const esriShapefile = require('shapefile');
const tmp = require('tmp-promise');
const util = require('util');
const unzipper = require('unzipper');
const { cookieOptions } = require('../util/cookies');
const { RequestValidationError, HttpError, ServerError } = require('../util/errors');
const { defaultObjectStore } = require('../util/object-store');
const { listToText } = require('../util/string');

const unlink = util.promisify(fs.unlink);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const appendFile = util.promisify(fs.appendFile);
const readdir = util.promisify(fs.readdir);

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
 * @param {string} dir The directory where the shapefile was extracted
 * @return {string} The path to the .shp file
 */
async function findShpFile(dir) {
  const shpFiles = (await readdir(dir)).filter((file) => path.extname(file) === '.shp');
  if (shpFiles.length !== 1) {
    throw new RequestValidationError(
      `Shapefiles must contain exactly one .shp file, found ${shpFiles.length}`,
    );
  }

  return path.join(dir, shpFiles[0]);
}

/**
 * Converts the given ESRI Shapefile to GeoJSON and returns the resulting file.   Note,
 * the caller MUST unlink the result to delete it
 *
 * @param {string} filename the path to the ESRI shapefile to convert (must be a .zip file)
 * @returns {string} path to a temporary file containing the GeoJSON
 * @throws {RequestValidationError} if something goes wrong
 */
async function esriToGeoJson(filename) {
  let geoJsonFile;
  let tempDir;

  try {
    geoJsonFile = await tmp.file();
    // let the `cleanup` function delete the directory even if it has files in it
    tempDir = await tmp.dir({ unsafeCleanup: true });

    // unzip the shapefile
    try {
      await fs.createReadStream(filename)
        .pipe(unzipper.Extract({ path: tempDir.path }))
        .promise();
    } catch (e) {
      throw new RequestValidationError(`Failed to unzip shapefile: ${e}`);
    }

    /**  convert to GeoJSON */

    const shpFilePath = await findShpFile(tempDir.path);
    // write the start of the FeatureCollection
    await writeFile(geoJsonFile.path, geoJsonFileStart, 'utf8');
    let isFirstLine = true;
    const featureSource = await esriShapefile.open(shpFilePath);
    let result = await featureSource.read();

    // write out each Feature
    while (result && !result.done) {
      if (isFirstLine) {
        isFirstLine = false;
      } else {
        await appendFile(geoJsonFile.path, ',\n', 'utf8');
      }
      // set the correct winding on the outer and inner rings of polygons
      const feature = rewind(result.value, false);
      await appendFile(geoJsonFile.path, JSON.stringify(feature), 'utf8');

      result = await featureSource.read();
    }

    // write out the end of the FeatureCollection
    await appendFile(geoJsonFile.path, geoJsonFileEnd, 'utf8');
  } catch (e) {
    if (geoJsonFile) geoJsonFile.cleanup();
    if (e instanceof RequestValidationError) throw e;
    throw new RequestValidationError(`Failed to process shapefile: ${e}`);
  } finally {
    // remove the temporary directory and its contents
    if (tempDir) tempDir.cleanup();
  }

  return geoJsonFile.path;
}

/**
 * Converts the given KML file to GeoJSON and returns the resulting file.   Note, the caller MUST
 * unlink the result to delete it
 *
 * @param {string} filename the path to the KML file to convert
 * @returns {string} path to a temporary file containing the GeoJSON
 */
async function kmlToGeoJson(filename) {
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
        throw new RequestValidationError(`Failed to process kml file: ${msg}`);
      },
    };
    const file = await readFile(filename, 'utf8');
    const kml = new DOMParser(parserOpts).parseFromString(file);
    const converted = togeojson.kml(kml);
    await writeFile(geoJsonFile.path, JSON.stringify(converted), 'utf8');
  } catch (e) {
    if (geoJsonFile) geoJsonFile.cleanup();
    if (e instanceof RequestValidationError) throw e;
    throw new RequestValidationError(`Failed to process kml file: ${e}`);
  }

  return geoJsonFile.path;
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

  try {
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
