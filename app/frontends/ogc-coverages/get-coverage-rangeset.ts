import { SpatialReference } from 'gdal-next';
import DataOperation from 'models/data-operation';
import { CmrVariable } from 'harmony/util/cmr';
import { Response } from 'express';
import keysToLowerCase from '../../util/object';
import { RequestValidationError } from '../../util/errors';
import wrap from '../../util/array';
import parseVariables from './util/variable-parsing';
import { parseSubsetParams, subsetParamsToBbox, subsetParamsToTemporal, ParameterParseError } from './util/parameter-parsing';
import { parseAcceptHeader } from '../../util/content-negotiation';
import HarmonyRequest from '../../models/harmony-request';

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset requests.  Responds with the actual coverage data.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {Function} next The next express handler
 * @returns {void}
 * @throws {RequestValidationError} Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function getCoverageRangeset(
  req: HarmonyRequest,
  res: Response,
  next: Function,
): void {
  req.context.frontend = 'ogcCoverages';
  const query = keysToLowerCase(req.query);

  const operation = new DataOperation();

  if (query.format) {
    operation.outputFormat = query.format;
  } else if (req.headers.accept) {
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    req.context.requestedMimeTypes = acceptedMimeTypes
      .map((v: { mimeType: string }) => v.mimeType)
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
      const vars = varInfo.variables.map((v: CmrVariable) => ({ id: v.concept_id, name: v.name }));
      operation.addSource(varInfo.collectionId, vars);
    } else {
      operation.addSource(varInfo.collectionId);
    }
  }

  req.operation = operation;
  next();
}
