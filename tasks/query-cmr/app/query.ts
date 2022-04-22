import _ from 'lodash';
import StacCatalog from './stac/catalog';
import CmrStacCatalog from './stac/cmr-catalog';
import { queryGranulesForScrollId } from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import logger from '../../../app/util/log';

export interface DataSource {
  collection: string;
  variables: unknown;
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
