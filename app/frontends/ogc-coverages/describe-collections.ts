import { Response } from 'express';
import { CmrCollection, CmrUmmVariable } from '../../util/cmr';
import HarmonyRequest from '../../models/harmony-request';
import { RequestValidationError } from '../../util/errors';
import { keysToLowerCase } from '../../util/object';
import { getSanitizedRequestUrl } from '../../util/url';
import parseVariables, { fullPath } from './util/variable-parsing';

const WGS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
const gregorian = 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian';

interface Extent {
  spatial: {
    bbox: number[];
    crs: string;
  };
}

/**
 * Creates the extent object returned in the collection listing
 * @param collection - the collection info as returned by the CMR
 * @returns the extent object
 */
export function generateExtent(collection: CmrCollection): Extent {
  let spatial;
  if (collection.boxes && collection.boxes.length > 0) {
    const bbox = collection.boxes[0].split(' ').map((v) => parseFloat(v));
    spatial = { bbox, crs: WGS84 };
  }

  let temporal;
  if (collection.time_start || collection.time_end) {
    temporal = { interval: [collection.time_start, collection.time_end], trs: gregorian };
  }

  const extent = (spatial || temporal) ? { spatial, temporal } : undefined;
  return extent;
}

/**
 * Helper that returns the information needed for a describe collection response
 * for the given CMR collection.
 *
 * @param collection - The CMR collection information
 * @param variable - The variable information
 * @param requestUrl - The request URL to use within links
 * @param extent - The spatial and temporal extent information for the CMR collection.
 * @returns The collection info matching the collectionInfo OGC schema.
 */
function buildCollectionInfo(
  collection: CmrCollection, variable: CmrUmmVariable, requestUrl: string, extent: Extent,
): object {
  const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
  const collectionLongLabel = `${collectionShortLabel} (${collection.archive_center || collection.data_center})`;
  return {
    id: `${collection.id}/${variable.meta['concept-id']}`,
    title: `${variable.umm.Name} ${collectionShortLabel}`,
    description: `${variable.umm.LongName} ${collectionLongLabel}`,
    links: [{
      title: `Perform rangeset request for ${variable.umm.Name}`,
      href: `${requestUrl}/coverage/rangeset`,
    }],
    extent,
    itemType: 'Variable',
    // TODO set CRS (HARMONY-242)
    // crs: 'TODO get from UMM-S or services.yml capabilities.output_projections',
  };
}

/**
 * Express.js-style handler that responds to OGC API - Coverages describe
 * collections requests.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export function describeCollections(req: HarmonyRequest, res: Response): void {
  const query = keysToLowerCase(req.query);
  if (query.f && query.f !== 'json') {
    throw new RequestValidationError(`Unsupported format "${query.f}". Currently only the json format is supported.`);
  }
  const links = [];
  const ogcCollections = [];
  const requestUrl = getSanitizedRequestUrl(req, false);
  const ogcApiRoot = requestUrl.replace(/\/collections$/, '');
  for (const collection of req.collections) {
    const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
    const rootLink = {
      title: `OGC coverages API root for ${collectionShortLabel}`,
      href: ogcApiRoot,
      rel: 'root',
      type: 'application/json',
    };
    const selfLink = {
      title: `Collections listing for ${collectionShortLabel}`,
      href: requestUrl,
      rel: 'self',
      type: 'application/json',
    };
    links.push(rootLink, selfLink);
    const extent = generateExtent(collection);
    // Include a link to perform a request asking for all variables in the EOSDIS collection
    const allVariables = { umm: { Name: 'all', LongName: 'All variables' }, meta: { 'concept-id': 'all' } };
    ogcCollections.push(buildCollectionInfo(collection, allVariables, `${requestUrl}/all`, extent));
    for (const variable of collection.variables) {
      const collectionInfo = buildCollectionInfo(
        collection, variable, `${requestUrl}/${encodeURIComponent(fullPath(variable))}`, extent,
      );
      ogcCollections.push(collectionInfo);
    }
  }
  res.send({
    links,
    collections: ogcCollections,
  });
}

/**
 * Express.js-style handler that responds to OGC API - Coverages describe
 * collection requests.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export function describeCollection(req: HarmonyRequest, res: Response): void {
  const query = keysToLowerCase(req.query);
  if (query.f && query.f !== 'json') {
    throw new RequestValidationError(`Unsupported format "${query.f}". Currently only the json format is supported.`);
  }
  const collection = req.collections[0];
  const requestUrl = getSanitizedRequestUrl(req, false);
  const extent = generateExtent(collection);
  const variableInfo = parseVariables([collection], req.params.collectionId);
  const variable = variableInfo[0].variables[0];
  const collectionInfo = buildCollectionInfo(collection, variable, requestUrl, extent);
  res.send(collectionInfo);
}
