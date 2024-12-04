import _ from 'lodash';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';
import { queryGranulesWithSearchAfter } from '../../harmony/app/util/cmr';
import DataOperation from '../../harmony/app/models/data-operation';
import defaultLogger from '../../harmony/app/util/log';
import { Logger } from 'winston';

export interface DataSource {
  collection: string;
  variables: unknown;
}

/**
 * Queries a single page of CMR granules using search after parameters, generating a STAC catalog for
 * each granule in the page.
 * @param requestId - The request ID of the job associated with this search
 * @param token - The token to use for the query
 * @param scrollId - Scroll session id used in the CMR-Scroll-Id header for granule search
 * @param maxCmrGranules - The maximum size of the page to request from CMR
 * @param filePrefix - The prefix to give each granule STAC item placed in the directory
 * @param logger - The logger to use for logging messages
 * @returns a tuple containing
 * the total size of the granules returned by this call, an array of sizes (in bytes) of each granule,
 * an array of STAC catalogs, a new session/search_after string (formerly scrollID), and the total
 * cmr hits.
 */
async function querySearchAfter(
  requestId: string,
  token: string,
  scrollId: string,
  maxCmrGranules: number,
  logger: Logger = defaultLogger,
): Promise<[number, number[], StacCatalog[], string, number]> {
  const filePrefix = './granule';
  let sessionKey, searchAfter;
  if (scrollId) {
    [sessionKey, searchAfter] = scrollId.split(':', 2);
  }
  const cmrResponse = await queryGranulesWithSearchAfter(
    token,
    maxCmrGranules,
    null,
    sessionKey,
    searchAfter,
    'umm_json',
  );

  const { hits } = cmrResponse;
  const newSearchAfter = cmrResponse.searchAfter;
  logger.info(`CMR Hits: ${hits}, Number of granules returned in this page: ${cmrResponse.granules.length}`);
  let totalItemsSize = 0;
  const outputItemSizes = [];
  const catalogs = cmrResponse.granules.map((granule) => {
    const archiveInfo = granule.umm.DataGranule?.ArchiveAndDistributionInformation;
    let granuleSize = 0;
    for (const info of archiveInfo || []) {
      if (info.Size) {
        granuleSize = info.Size;
        break;
      }
    }

    let granuleSizeInBytes = granuleSize * 1024 * 1024;
    // NaN will fail the first check
    if (granuleSizeInBytes != granuleSizeInBytes || granuleSizeInBytes < 0) {
      granuleSizeInBytes = 0;
    }
    outputItemSizes.push(granuleSizeInBytes);
    totalItemsSize += granuleSize;
    const result = new CmrStacCatalog({ description: `CMR collection ${granule.meta['collection-concept-id']}, granule ${granule.meta['concept-id']}` });
    result.links.push({
      rel: 'harmony_source',
      href: `${process.env.CMR_ENDPOINT}/search/concepts/${granule.meta['collection-concept-id']}`,
    });
    result.addCmrUmmGranules([granule], `${filePrefix}_${granule.meta['concept-id']}_`, logger);

    return result;
  });

  const newScrollId = `${sessionKey}:${newSearchAfter}`;

  return [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits];

}

/**
 * Queries a single page (up to 2,000 granules) using the given search after parameter,
 * producing a STAC catalog per granule.
 *
 * @param operation - The harmony data operation which contains the access token
 * @param scrollId - The colon separated session key and search after string, i.e.,
 * `session_key:search_after_string`
 * @param maxCmrGranules - The maximum size of the page to request from CMR
 * @param logger - The logger to use for logging messages
 * @returns a tuple containing
 * the total size of the granules returned by this call, an array of STAC catalogs,
 * a new session/search_after string (formerly scrollID), and the total cmr hits.
 */
export async function queryGranules(
  operation: DataOperation,
  scrollId: string,
  maxCmrGranules: number,
  logger: Logger = defaultLogger,
): Promise<[number, number[], StacCatalog[], string, number]> {
  const { unencryptedAccessToken } = operation;
  const [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits] =
    await querySearchAfter(operation.requestId, unencryptedAccessToken, scrollId, maxCmrGranules, logger);

  return [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits];
}
