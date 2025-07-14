import _ from 'lodash';
import { Logger } from 'winston';

import {
  getResultsLimitedMessageImpl, GranuleLimitReason,
} from '../../harmony/app/middleware/cmr-granule-locator';
import DataOperation from '../../harmony/app/models/data-operation';
import { queryGranulesWithSearchAfter } from '../../harmony/app/util/cmr';
import { CmrError, RequestValidationError, ServerError } from '../../harmony/app/util/errors';
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
 * @returns a promise containing a QueryCmrResponse with
 * the total size of the granules returned by this call, an array of STAC catalogs,
 * a new session/search_after string (formerly scrollID), and the total cmr hits.
 */
export async function queryGranules(
  operation: DataOperation,
  scrollId: string,
  maxCmrGranules: number,
  logger: Logger,
): Promise<QueryCmrResponse> {
  const { unencryptedAccessToken } = operation;
  // Include OPeNDAP links in the response unless the data operation explicitly overrides
  // by setting extraArgs.includeOpendapLinks to false
  const includeOpendapLinks = operation.extraArgs?.include_opendap_links !== false;
  const [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits] =
    await querySearchAfter(
      operation.requestId, unencryptedAccessToken, scrollId, maxCmrGranules, logger,
      includeOpendapLinks,
    );

  return { totalItemsSize, outputItemSizes, stacCatalogs: catalogs, scrollID: newScrollId, hits };
}

interface GranValidation {
  reason?: GranuleLimitReason;
  hasGranuleLimit?: boolean;
  serviceName?: string;
  shapeType?: string;
  maxResults?: number;
}

export interface QueryCmrResponse {
  hits?: number;
  totalItemsSize?: number;
  outputItemSizes?: number[];
  stacCatalogs?: StacCatalog[];
  scrollID?: string;
  error?: string;
  errorLevel?: 'warning' | 'error';
  errorCategory?: string;
  retryable?: boolean;
}

/**
 * Perform the initial granule validation, returns the validation errors if failed
 * or results limited message if successful as the result.
 * This function is only called when granule validation becomes part of the query-cmr
 * task (forceAsync=true).
 * errorCategory: 'granValidation' is used to indicate that the query-cmr result is
 * the result of granule validation to service-runner and work-updater which will
 * process the result accordingly.
 *
 * @param operation - The harmony data operation which contains the access token
 * @param scrollId - The session key to store query params in S3
 * @param maxCmrGranules - The maximum size of the page to request from CMR
 * @param logger - The logger to use for logging messages
 * @returns a promise of QueryCmrResponse
 */
export async function validateGranules(
  operation: DataOperation,
  scrollId: string,
  maxCmrGranules: number,
  logger: Logger,
): Promise<QueryCmrResponse> {
  let jobHits: number = 0;
  const jobMessages = [];

  const granValidation = operation.extraArgs?.granValidation as GranValidation | undefined;

  const reason = granValidation?.reason;
  const hasGranuleLimit = granValidation?.hasGranuleLimit;
  const serviceName = granValidation?.serviceName;
  const shapeType = granValidation?.shapeType;
  const maxResults = granValidation?.maxResults;

  try {
    const { requestId, sources, unencryptedAccessToken } = operation;
    logger.info(`Querying granules for ${sources[0].collection}`, { collection: sources[0].collection });
    const startTime = new Date().getTime();

    const { hits } = await queryGranulesWithSearchAfter(
      { 'id': requestId },
      unencryptedAccessToken,
      maxCmrGranules,
      {},
      scrollId,
    );
    if (hits === 0) {
      return {
        hits: 0,
        error: 'No matching granules found.',
        errorLevel: 'error',
        errorCategory: 'granValidation',
      };
    }
    jobHits = hits;
    const msTaken = new Date().getTime() - startTime;
    logger.info('timing.cmr-validate-granule.end', { durationMs: msTaken, hits });

    const limitedMessage = getResultsLimitedMessageImpl(hits, maxResults, maxCmrGranules, reason, serviceName, hasGranuleLimit, sources[0].collection);
    if (limitedMessage) {
      jobMessages.push(limitedMessage);
    }
  } catch (e) {
    if (e instanceof RequestValidationError || e instanceof CmrError) {
      // Avoid giving confusing errors about GeoJSON due to upstream converted files
      if (e.message.indexOf('GeoJSON') !== -1 && shapeType) {
        e.message = e.message.replace('GeoJSON', `GeoJSON (converted from the provided ${shapeType})`);
      }
      logger.error(e);
      return {
        hits: 0,
        error: e.message,
        errorLevel: 'error',
        errorCategory: 'granValidation',
      };
    }
    logger.error(e);
    throw new ServerError('Failed to query the CMR');
  }

  // use errorCategory: 'granValidation' to indicate success with the job hits and message
  if (jobMessages.length > 0) {
    return {
      hits: jobHits,
      scrollID: scrollId,
      error: jobMessages.join(' '),
      errorLevel: 'warning',
      errorCategory: 'granValidation',
    };
  } else {
    return {
      hits: jobHits,
      scrollID: scrollId,
      errorLevel: 'warning',
      errorCategory: 'granValidation',
    };
  }
}
