import _ from 'lodash';
import { Logger } from 'winston';

import DataOperation from '../../harmony/app/models/data-operation';
import { queryGranulesWithSearchAfter } from '../../harmony/app/util/cmr';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';

export interface DataSource {
  collection: string;
  variables: unknown;
}

/**
 * Calculates the granule size in bytes based on the CMR metadata
 *
 * @param logger - the logger
 * @param archiveInfo - the ArchiveAndDistributionInformation field from the CMR
 * @returns the file size of the granule in bytes
 */
export function getGranuleSizeInBytes(
  logger: Logger,
  archiveInfo?: { SizeInBytes?: number; Size?: number; SizeUnit?: string }[],
): number {
  let granuleSizeInBytes = 0;

  for (const info of archiveInfo || []) {
    if (typeof info.SizeInBytes === 'number') {
      granuleSizeInBytes += info.SizeInBytes;
    } else if (typeof info.Size === 'number' && info.SizeUnit) {
      switch (info.SizeUnit) {
      case 'KB':
        granuleSizeInBytes += info.Size * 1024;
        break;
      case 'MB':
      case 'NA':
        // Historically ECHO and CMR metadata formats always reported sizes in MB so when
        // the unit is not explicitly set we assume MB
        granuleSizeInBytes += info.Size * 1024 * 1024;
        break;
      case 'GB':
        granuleSizeInBytes += info.Size * 1024 * 1024 * 1024;
        break;
      case 'TB':
        granuleSizeInBytes += info.Size * 1024 * 1024 * 1024 * 1024;
        break;
      case 'PB':
        granuleSizeInBytes += info.Size * 1024 * 1024 * 1024 * 1024 * 1024;
        break;
      default:
        logger.warn(`Unknown SizeUnit: ${info.SizeUnit}`);
      }
    }
  }

  return granuleSizeInBytes;
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
 * @param includeOpendapLinks - if true include OPeNDAP links in the catalog
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
  logger: Logger,
  includeOpendapLinks: boolean,
): Promise<[number, number[], StacCatalog[], string, number]> {
  const filePrefix = './granule';
  let sessionKey, searchAfter;
  if (scrollId) {
    [sessionKey, searchAfter] = scrollId.split(':', 2);
  }
  const cmrResponse = await queryGranulesWithSearchAfter(
    { 'id': requestId },
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
    const granuleSizeInBytes = getGranuleSizeInBytes(logger, archiveInfo);
    outputItemSizes.push(granuleSizeInBytes);
    const granuleSizeInMB = granuleSizeInBytes / 1024 / 1024;
    totalItemsSize += granuleSizeInMB;
    const result = new CmrStacCatalog({ description: `CMR collection ${granule.meta['collection-concept-id']}, granule ${granule.meta['concept-id']}` });
    result.links.push({
      rel: 'harmony_source',
      href: `${process.env.CMR_ENDPOINT}/search/concepts/${granule.meta['collection-concept-id']}`,
    });
    result.addCmrUmmGranules([granule], `${filePrefix}_${granule.meta['concept-id']}_`, logger, includeOpendapLinks);

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
  logger: Logger,
): Promise<[number, number[], StacCatalog[], string, number]> {
  const { unencryptedAccessToken } = operation;
  // Include OPeNDAP links in the response unless the data operation explicitly overrides
  // by setting extraArgs.includeOpendapLinks to false
  const includeOpendapLinks = operation.extraArgs?.include_opendap_links !== false;
  const [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits] =
    await querySearchAfter(
      operation.requestId, unencryptedAccessToken, scrollId, maxCmrGranules, logger,
      includeOpendapLinks,
    );

  return [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits];
}
