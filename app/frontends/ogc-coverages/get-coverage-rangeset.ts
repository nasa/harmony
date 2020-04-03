const { SpatialReference } = require('gdal-next');
const get = require('lodash.get');
const DataOperation = require('../../models/data-operation');
const { keysToLowerCase } = require('../../util/object');
const { RequestValidationError } = require('../../util/errors');
const { wrap } = require('../../util/array');
const { parseVariables } = require('./util/variable-parsing');
const { parseSubsetParams, subsetParamsToBbox, subsetParamsToTemporal, ParameterParseError } = require('./util/parameter-parsing');
const { parseAcceptHeader } = require('../../util/content-negotiation');
const { cookieOptions } = require('../../util/cookies');
const { defaultObjectStore } = require('../../util/object-store');

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset requests.  Responds with the actual coverage data.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {function} next The next express handler
 * @returns {void}
 * @throws {RequestValidationError} Thrown if the request has validation problems and
 *   cannot be performed
 */
function getCoverageRangeset(req, res, next) {
  req.context.frontend = 'ogcCoverages';
  const query = keysToLowerCase(req.query);

  const operation = new DataOperation();

  const shapefile = get(req, 'files.shapefile[0]') || req.signedCookies.shapefile;
  res.clearCookie('shapefile', cookieOptions);

  if (shapefile) {
    if (shapefile.mimetype !== 'application/geo+json') {
      // HARMONY-243 will need to convert other types to GeoJSON here and update the exception
      throw new RequestValidationError(`Shapefiles must have content type "application/geo+json".  Received ${shapefile.mimetype}`);
    }
    operation.geojson = defaultObjectStore().getUrlString(shapefile.bucket, shapefile.key);
  }

  if (query.format) {
    operation.outputFormat = query.format;
  } else if (req.headers.accept) {
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    req.context.requestedMimeTypes = acceptedMimeTypes
      .map((v) => v.mimeType)
      .filter((v) => v);
  }

  if (query.granuleid) {
    operation.granuleIds = query.granuleid;
  }
  if (query.outputcrs) {
    try {
      operation.crs = SpatialReference.fromUserInput(query.outputcrs).toProj4();
    } catch (e) {
      throw new RequestValidationError('query parameter "outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.');
    }
  }
  operation.interpolationMethod = query.interpolation;
  if (query.scaleextent) {
    const [xMin, yMin, xMax, yMax] = query.scaleextent;
    operation.scaleExtent = { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
  }
  operation.outputWidth = query.width;
  operation.outputHeight = query.height;
  if (query.scalesize) {
    const [x, y] = query.scalesize;
    operation.scaleSize = { x, y };
  }
  try {
    const subset = parseSubsetParams(wrap(query.subset));
    const bbox = subsetParamsToBbox(subset);
    if (bbox) {
      operation.boundingRectangle = bbox;
    }
    const { startTime, stopTime } = subsetParamsToTemporal(subset);
    if (startTime || stopTime) {
      operation.temporal = [startTime, stopTime];
    }
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      throw new RequestValidationError(`query parameter "subset" ${e.message}`);
    }
    throw e;
  }

  const varInfos = parseVariables(req.collections, req.params.collectionId);
  for (const varInfo of varInfos) {
    if (varInfo.variables) {
      const sourceVars = varInfo.variables.map((v) => ({ id: v.concept_id, name: v.name }));
      operation.addSource(varInfo.collectionId, sourceVars);
    } else {
      operation.addSource(varInfo.collectionId);
    }
  }

  req.operation = operation;
  next();
}

module.exports = getCoverageRangeset;
