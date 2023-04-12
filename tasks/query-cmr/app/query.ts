import _ from 'lodash';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';
import { queryGranulesWithSearchAfter } from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import defaultLogger from '../../../app/util/log';
import { Logger } from 'winston';

export interface DataSource {
  collection: string;
  variables: unknown;
}

/**
 * Queries a single page of CMR granules using search after parameters, generating a STAC catalog for
 * each granule in the page.
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
  token: string,
  scrollId: string,
  filePrefix: string,
  maxCmrGranules: number,
  logger: Logger = defaultLogger,
): Promise<[number, number[], StacCatalog[], string, number]> {
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
  );
  const { hits } = cmrResponse;
  const newSearchAfter = cmrResponse.searchAfter;
  logger.info(`CMR Hits: ${hits}, Number of granules returned in this page: ${cmrResponse.granules.length}`);
  let totalItemsSize = 0;
  const outputItemSizes = [];
  const catalogs = cmrResponse.granules.map((granule) => {
    const granuleSize = granule.granule_size ? parseFloat(granule.granule_size) : 0;
    let granuleSizeInBytes = granuleSize * 1024 * 1024;
    // NaN will fail the first check
    if (granuleSizeInBytes != granuleSizeInBytes || granuleSizeInBytes < 0) {
      granuleSizeInBytes = 0;
    }
    outputItemSizes.push(granuleSizeInBytes);
    totalItemsSize += granuleSize;
    const result = new CmrStacCatalog({ description: `CMR collection ${granule.collection_concept_id}, granule ${granule.id}` });
    result.links.push({
      rel: 'harmony_source',
      href: `${process.env.CMR_ENDPOINT}/search/concepts/${granule.collection_concept_id}`,
    });
    result.addCmrGranules([granule], `${filePrefix}_${granule.id}_`, logger);

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
    await querySearchAfter(unencryptedAccessToken, scrollId, './granule', maxCmrGranules, logger);

  return [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits];
}
