import { promises as fs } from 'fs';
import assert from 'assert';
import _ from 'lodash';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';
import { queryGranulesForScrollId, queryGranulesForCollection as cmrQueryGranules } from '../../../app/util/cmr';
import { objectStoreForProtocol } from '../../../app/util/object-store';
import DataOperation from '../../../app/models/data-operation';
import logger from '../../../app/util/log';

export interface DataSource {
  collection: string;
  variables: unknown;
}

/**
 * Queries all pages of a single source, creating a STAC catalog and items for all
 * granules
 * @param token - the token to use for the query
 * @param source - the source collection / variables from the Harmony message
 * @param queryLocation - a file location containing a CMR query to perform
 * @param pageSize - The size of each page to be accessed
 * @param maxPages - The maximum number of pages to be accessed from each source
 * @param batchSize - The maximum number of granules to include in each catalog
 * @param filePrefix - the prefix to give each file placed in the directory
 * @returns a STAC catalog containing items for each granule
 */
export async function querySource(
  token: string,
  source: DataSource,
  queryLocation: string,
  pageSize: number,
  maxPages: number,
  batchSize: number,
  filePrefix: string,
): Promise<StacCatalog[]> {
  let page = 0;
  let done = false;

  const store = objectStoreForProtocol(queryLocation);
  const queryFile = store ? await store.downloadFile(queryLocation) : queryLocation;
  const cmrQuery = JSON.parse(await fs.readFile(queryFile, 'utf8'));
  const catalogs = [];
  while (!done) {
    const cmrResponse = await cmrQueryGranules(
      source.collection,
      cmrQuery,
      token,
      pageSize,
    );

    const batches = _.chunk(cmrResponse.granules, batchSize);
    batches.forEach((batch, index) => {
      const result = new CmrStacCatalog({ description: `CMR Granules for ${source.collection} batch ${index + 1}` });
      result.links.push({
        rel: 'harmony_source',
        href: `${process.env.CMR_ENDPOINT}/search/concepts/${source.collection}`,
      });
      result.addCmrGranules(batch, `${filePrefix}_${index}_`);
      catalogs.push(result);
    });
    done = ++page < maxPages || true;
  }
  return catalogs;
}

/**
 * Queries a single page of CMR granules using a scrollId, generating a STAC catalog for
 * each granule in the page.
 * @param token - The token to use for the query
 * @param scrollId - Scroll session id used in the CMR-Scroll-Id header for granule search
 * @param maxCmrGranules - The maximum size of the page to request from CMR
 * @param filePrefix - The prefix to give each file placed in the directory
 * @returns A single STAC catalog for each granule (each with a single STAC item)
 */
export async function queryScrollId(
  token: string,
  scrollId: string,
  filePrefix: string,
  maxCmrGranules?: number,
): Promise<StacCatalog[]> {
  const cmrResponse = await queryGranulesForScrollId(
    scrollId,
    token,
    maxCmrGranules,
  );
  const { hits } = cmrResponse;
  logger.info(`CMR Hits: ${hits}, Number of granules returned in this page: ${cmrResponse.granules.length}`);
  const catalogs = cmrResponse.granules.map((granule) => {
    const result = new CmrStacCatalog({ description: `CMR collection ${granule.collection_concept_id}, granule ${granule.id}` });
    result.links.push({
      rel: 'harmony_source',
      href: `${process.env.CMR_ENDPOINT}/search/concepts/${granule.collection_concept_id}`,
    });
    result.addCmrGranules([granule], `${filePrefix}_${granule.id}_`);

    return result;
  });

  return catalogs;

}

/**
 * Queries all granules for each collection / variable source in DataOperation.sources,
 * producing a STAC catalog per source.  Returns a STAC parent catalog containing
 * all of the sources
 *
 * @param operation - The operation which containing sources to query
 * @param queries - A list of file locations containing the queries to perform
 * @param pageSize - The size of each page to be accessed
 * @param maxPages - The maximum number of pages to be accessed from each source
 * @param batchSize - The maximum number of granules to include in each catalog
 * @returns a root STAC catalog pointing to source catalogs for each data source
 */
export async function queryGranules(
  operation: DataOperation,
  queries: string[],
  pageSize: number,
  maxPages: number,
  batchSize: number,
): Promise<StacCatalog[]> {
  const { sources, unencryptedAccessToken } = operation;

  assert(sources && sources.length === queries.length, 'One query must be provided per input source');
  const promises = [];
  for (let i = 0; i < sources.length; i++) {
    const result = querySource(unencryptedAccessToken, sources[i], queries[i], pageSize, maxPages, batchSize, `./granule_${i}`);
    promises.push(result);
  }

  const catalogs = _.flatten(await Promise.all(promises));

  return catalogs;
}

/**
 * Queries a single page (up to 2,000 granules) for the given CMR scrollId,
 * producing a STAC catalog per granule.  Returns an array of STAC catalogs.
 *
 * @param operation - The harmony data operation which contains the access token
 * @param scrollId - Scroll session id used in the CMR-Scroll-Id header for granule search
 * @param maxCmrGranules - The maximum size of the page to request from CMR
 * @returns A STAC catalog for each granule in a single page of results
 */
export async function queryGranulesScrolling(
  operation: DataOperation,
  scrollId: string,
  maxCmrGranules?: number,
): Promise<StacCatalog[]> {
  const { unencryptedAccessToken } = operation;
  const catalogs = await queryScrollId(unencryptedAccessToken, scrollId, `./granule_${scrollId}`, maxCmrGranules);

  return catalogs;
}
