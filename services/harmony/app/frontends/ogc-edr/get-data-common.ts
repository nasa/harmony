import DataOperation from '../../models/data-operation';
import HarmonyRequest from '../../models/harmony-request';
import wrap from '../../util/array';
import { handleAveragingType, handleCrs, handleExtend, handleFormat, handleGranuleIds, handleGranuleNames, handleScaleExtent, handleScaleSize } from '../../util/parameter-parsers';
import { createDecrypter, createEncrypter } from '../../util/crypto';
import env from '../../util/env';
import { RequestValidationError } from '../../util/errors';
import { keysToLowerCase } from '../../util/object';
import { ParameterParseError } from '../../util/parameter-parsing-helpers';
import { parseVariables } from '../../util/variables';
import { parseDatetime } from './util/helper';
import { parseSubsetParams } from '../ogc-coverages/util/subset-parameter-parsing';

/**
 * Common code for OGC EDR spatial queries.
 *
 * @param req - The request sent by the client
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export function getDataCommon(
  req: HarmonyRequest,
): void {
  req.context.frontend = 'ogcEdr';
  const query = keysToLowerCase(req.query);

  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(null, encrypter, decrypter);

  handleFormat(operation, query.f, req);
  handleExtend(operation, query);
  handleGranuleIds(operation, query);
  handleGranuleNames(operation, query);
  handleCrs(operation, query.crs);
  handleScaleExtent(operation, query);
  handleScaleSize(operation, query);
  handleAveragingType(operation, query);

  operation.interpolationMethod = query.interpolation;
  operation.outputWidth = query.width;
  operation.outputHeight = query.height;
  if (query.forceasync) {
    operation.isSynchronous = false;
  }

  operation.ignoreErrors = query.ignoreerrors === false ? false : true;
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
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      throw new RequestValidationError(`query parameter "subset" ${e.message}`);
    }
    throw e;
  }

  const { start, end } = parseDatetime(query.datetime);
  if (start || end) {
    operation.temporal = { start, end };
  }

  let queryVars = req.query['parameter-name'] as string | string[];
  if (!queryVars) {
    // set variables to 'all' when no parameter-name is provided for EDR request
    queryVars = ['all'];
  }

  const varInfos = parseVariables(req.collections, 'parameter_vars', queryVars);
  for (const varInfo of varInfos) {
    operation.addSource(varInfo.collectionId, varInfo.shortName, varInfo.versionId,
      varInfo.variables, varInfo.coordinateVariables);
  }

  req.operation = operation;
}
