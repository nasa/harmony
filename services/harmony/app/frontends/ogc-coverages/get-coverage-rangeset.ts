import { NextFunction, Response } from 'express';

import DataOperation from '../../models/data-operation';
import HarmonyRequest from '../../models/harmony-request';
import wrap from '../../util/array';
import { createDecrypter, createEncrypter } from '../../util/crypto';
import env from '../../util/env';
import { RequestValidationError } from '../../util/errors';
import { keysToLowerCase } from '../../util/object';
import {
  handleAveragingType, handleCrs, handleExtend, handleForceAsync, handleFormat, handleGranuleIds,
  handleGranuleNames, handleHeight, handleIgnoreErrors, handlePixelSubset, handleScaleExtent,
  handleScaleSize, handleWidth, validateBooleanParameters,
} from '../../util/parameter-parsers';
import { ParameterParseError } from '../../util/parameter-parsing-helpers';
import { parseVariables } from '../../util/variables';
import {
  parsePointParam, parseSubsetParams, subsetParamsToBbox, subsetParamsToTemporal,
} from './util/subset-parameter-parsing';

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset requests. Responds with the actual coverage data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function getCoverageRangeset(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  req.context.frontend = 'ogcCoverages';
  validateBooleanParameters(req.query);
  const query = keysToLowerCase(req.query);

  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(null, encrypter, decrypter);

  handleFormat(operation, query.format, req);
  handleExtend(operation, query);
  handleGranuleIds(operation, query);
  handleGranuleNames(operation, query);
  handleCrs(operation, query.outputcrs);
  handleScaleExtent(operation, query);
  handleScaleSize(operation, query);
  handleHeight(operation, query);
  handleWidth(operation, query);
  handleAveragingType(operation, query);
  handleForceAsync(operation, query);
  handleIgnoreErrors(operation, query);
  handlePixelSubset(operation, query);

  operation.interpolationMethod = query.interpolation;
  operation.destinationUrl = query.destinationurl;

  try {
    const subset = parseSubsetParams(wrap(query.subset));
    operation.dimensions = [];
    Object.entries(subset).forEach(([key, value]) => {
      if (!['time', 'lat', 'lon'].includes(key)) {
        operation.dimensions.push({
          name: key,
          min: value.min as number,
          max: value.max as number,
        });
      }
    });

    const bbox = subsetParamsToBbox(subset);
    if (bbox) {
      operation.boundingRectangle = bbox;
    }
    const point = parsePointParam(query.point);
    if (point) {
      if (bbox) {
        throw new RequestValidationError('bounding_box and point query parameters should not co-exist');
      }
      operation.spatialPoint = point;
    }
    const { start, end } = subsetParamsToTemporal(subset);
    if (start || end) {
      operation.temporal = { start, end };
    }
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      throw new RequestValidationError(`query parameter "subset" ${e.message}`);
    }
    throw e;
  }

  const queryVars = req.query.variable as string | string[];
  const requestedVariables = parseVariables(req.params.collectionId, queryVars);
  req.context.requestedVariables = requestedVariables;

  req.operation = operation;
  next();
}


