import { promises as fs } from 'fs';
import path from 'path';
import { queryGranulesForCollectionWithMultipartForm as queryGranules } from '../../../app/util/cmr';
import DataOperation, { HarmonyGranule } from '../../../app/models/data-operation';
import { computeMbr } from '../../../app/util/spatial/mbr';

export interface DataSource {
  collection: string;
  variables: unknown;
}

/**
 * Queries all pages of a single source, writing each page to a file in the given dir
 * with the given prefix
 * @param token the token to use for the query
 * @param source the source collection / variables from the Harmony message
 * @param queryLocation a file location containing a CMR query to perform
 * @param outputDir the output directory to place source files in
 * @param pageSize The size of each page to be accessed
 * @param maxPages The maximum number of pages to be accessed from each source
 * @param filePrefix the prefix to give each file placed in the directory
 */
export async function querySource(
  token: string,
  source: DataSource,
  queryLocation: string,
  outputDir: string,
  pageSize: number,
  maxPages: number,
  filePrefix: string,
): Promise<string[]> {
  const result = [];
  let page = 0;
  let done = false;
  while (!done) {
    const cmrQuery = JSON.parse(await fs.readFile(queryLocation, 'utf8'));

    const cmrResponse = await queryGranules(
      source.collection,
      cmrQuery,
      token,
      pageSize,
    );

    const { granules: jsonGranules } = cmrResponse;
    const granules = [];
    for (const granule of jsonGranules) {
      const links = granule.links.filter((g) => g.rel.endsWith('/data#') && !g.inherited);
      if (links.length > 0) {
        // HARMONY-554 TODO: Writing a correct bounding box requires having the collection's MBR
        const box = computeMbr(granule) /* || computeMbr(collection) */ || [-180, -90, 180, 90];
        const gran: HarmonyGranule = {
          id: granule.id,
          name: granule.title,
          urls: links.map((l) => l.href),
          bbox: box,
          temporal: {
            start: granule.time_start,
            end: granule.time_end,
          },
        };
        granules.push(gran);
      }
    }
    const output = [{ ...source, granules }];
    const filename = path.join(outputDir, `${filePrefix}${page}.json`);
    result.push((async (): Promise<string> => {
      await fs.writeFile(filename, JSON.stringify(output), 'utf8');
      return filename;
    })());

    // TODO: Scroll ID and loop behavior to be added in the No Granule Limit epic.
    // For now, we finish on the first page.  Will need to add logic to see if we've
    // reached the last page before we hit maxPages
    done = ++page < maxPages || true;
  }
  return result;
}

/**
 * Queries all granules for each collection / variable source in DataOperation.sources,
 * producing one file of output per page per source.  Returns a list of the files produced
 *
 * @param operation The operation which containing sources to query
 * @param queries A list of file locations containing the queries to perform
 * @param outputDir The directory where output files should be placed
 * @param pageSize The size of each page to be accessed
 * @param maxPages The maximum number of pages to be accessed from each source
 * @returns a list of all files produced
 */
export default async function query(
  operation: DataOperation,
  queries: string[],
  outputDir: string,
  pageSize: number,
  maxPages: number,
): Promise<string[]> {
  const { sources, unencryptedAccessToken } = operation;

  if (!sources || sources.length !== queries.length) {
    throw new Error('One query must be provided per input source');
  }
  const promises = [];
  for (let i = 0; i < sources.length; i++) {
    const result = querySource(unencryptedAccessToken, sources[i], queries[i], outputDir, pageSize, maxPages, `${i}_`);
    promises.push(result);
  }
  return [].concat(...await Promise.all(promises));
}
