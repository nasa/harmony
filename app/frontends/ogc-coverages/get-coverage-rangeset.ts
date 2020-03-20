const { SpatialReference } = require('gdal-next');
const DataOperation = require('../../models/data-operation');
const { keysToLowerCase } = require('../../util/object');
const { RequestValidationError } = require('../../util/errors');
const { wrap } = require('../../util/array');
const { parseVariables } = require('./util/variable-parsing');
const { parseSubsetParams, subsetParamsToBbox, subsetParamsToTemporal, ParameterParseError } = require('./util/parameter-parsing');

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
  const query = keysToLowerCase(req.query);
  const operation = new DataOperation();
  operation.outputFormat = 'image/tiff'; // content negotiation to be added in HARMONY-173

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
