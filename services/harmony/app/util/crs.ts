import { SRS } from '../models/data-operation';
import { RequestValidationError } from './errors';
import { fromUserInput } from './spatial/spatial-ref';

/**
 * Parse a CRS string given as a parameter and return a proj4 string and SRS
 *
 * @param queryCRS_ - The CRS information to be processed
 * @param validate - An optional boolean on whether to throw an exception
 *   on failure
 * @returns An array containing the proj4 string and SRS
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function parseCRS(
  queryCRS_: string, validate = true,
): [string, SRS] {
  try {
    const spatialRef = fromUserInput(queryCRS_);
    const srs: SRS = {
      proj4: spatialRef.proj4String,
      wkt: spatialRef.wkt ?? '',
      epsg: spatialRef.epsg,
    };
    return [spatialRef.proj4String, srs];
  } catch (e) {
    if (validate) {
      throw new RequestValidationError('query parameter "crs/outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.');
    } else {
      return [queryCRS_, null];
    }
  }
}