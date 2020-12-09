import { promises as fs } from 'fs';
import assert from 'assert';
import _ from 'lodash';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';
import { queryGranulesForCollectionWithMultipartForm as cmrQueryGranules } from '../../../app/util/cmr';
import { objectStoreForProtocol } from '../../../app/util/object-store';
import DataOperation from '../../../app/models/data-operation';
import env from '../../../app/util/env';

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
        href: `${env.cmrEndpoint}/search/concepts/${source.collection}`,
      });
      result.addCmrGranules(batch, `${filePrefix}_${index}_`);
      catalogs.push(result);
    });

    // TODO HARMONY-276 Scroll ID and loop behavior to be added in the No Granule Limit epic.
    //      They should use the new scroll API changes from CMR-6830
    // For now, we finish on the first page.  Will need to add logic to see if we've
    // reached the last page before we hit maxPages. Will need to handle cases where
    // a single batch should cross multiple pages (e.g with a batch size of 1950 and a
    // page size of 2000 you would not want a batch of 1950 and a batch of 50 for each
    // page).
    done = ++page < maxPages || true;
  }
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
