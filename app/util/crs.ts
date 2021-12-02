import { SpatialReference } from 'gdal';
import { RequestValidationError } from './errors';
import { SRS } from '../models/data-operation';

/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset requests.  Responds with the actual coverage data.
 *
 * @param queryCRS - The CRS information to be processed
 * @param validate - An optional boolean on whether to throw an exception
 *   on failure
 * @returns The proj4 string and SRS
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function parseCRS(
  { queryCRS_, validate = true }: { queryCRS_: string; validate?: boolean },
): [string, SRS] {
  try {
    let queryCRS: string = null;
    let epsg = '';

    // detect opengis.net PURLs
    const purl = /www.opengis.net\/def\/crs\/EPSG\/0\/(\d+)$/i.exec(queryCRS_);
    if (purl) {
      epsg = `EPSG:${purl[1]}`;
      queryCRS = epsg;
    } else {
      queryCRS = queryCRS_;
    }

    // try other ways to match an EPSG
    if (!epsg) {
      if (/^crs:84$/i.test(queryCRS)) {
        epsg = 'EPSG:4326';
      } else if (/^epsg:\d+$/i.test(queryCRS)) {
        epsg = queryCRS;
      }
    }

    // create crs and srs
    const spatialRef = SpatialReference.fromUserInput(queryCRS);
    const crs = spatialRef.toProj4();
    const srs: SRS = {
      proj4: spatialRef.toProj4(),
      wkt: spatialRef.toWKT(),
      epsg,
    };

    return [crs, srs];
  } catch (e) {
    if (validate) {
      throw new RequestValidationError('query parameter "outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.');
    } else {
      return [queryCRS_, null];
    }
  }
}
