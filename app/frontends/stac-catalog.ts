import { pick } from 'lodash';
import { Job } from 'models/job';
import JobLink from 'models/job-link';

export interface SerializableCatalog {
  id: string;

  stac_version: string;

  title: string;

  description: string;

  links: JobLink[];
}

/**
 *
 * Class for creating STAC catalog for data produced by a Harmony Job
 *
 * Fields:
 *   - id: ID of the STAC Catalog
 *   - title: Title of the STAC Catalog
 *   - description: Description of the Catalog
 *   - links: An array of STAC Link objects
 *
 * @example
 * catalog = new HarmonyCatalog("123", "AIRX3STD (2003-2004)", "AIRS/Aqua L3 Daily for 2003-2004");
 * jsonObj = catalog.toJSON();
 * jsonStr = JSON.stringify(catalog, null, 2);
 *
 */
class HarmonyCatalog implements SerializableCatalog {
  id: string;

  stac_version: string;

  title: string;

  description: string;

  links: JobLink[];

  /**
   *
   * @param id - ID of the STAC Catalog
   * @param title - Title of the STAC Catalog
   * @param description - Description of the STAC Catalog
   */
  constructor(id: string, title = '', description = '') {
    this.id = id;
    this.stac_version = '0.9.0';
    this.title = title;
    this.description = description;
    this.links = [];
  }

  /**
   * Adds a member to 'links' property of a STAC Catalog
   *
   * @param url - Link URL
   * @param relType - Relation type: [self, root, item]
   * @param title - Link title (human readable)
   *
   */
  addLink(url: string, relType: string, title: string): void {
    this.links.push(
      new JobLink({
        href: url,
        rel: relType,
        title,
      }),
    );
  }

  /**
   * Placeholder method to support custom stringification
   *
   * @returns - STAC Catalog JSON
   */
  toJSON(): SerializableCatalog {
    const paths = ['id', 'stac_version', 'title', 'description', 'links'];
    return pick(this, paths) as SerializableCatalog;
  }
}

/**
 * Function to create the STAC Catalog given a Harmony Job object
 *
 * @param job - Harmony Job object
 * @param stacDataLinks - JobLink's to add to catalog
 * @param pagingLinks - links pointing to the next, previous, and current page
 * @param linkType - the type of data links that the stac-items should use
 *
 * @returns - STAC Catalog JSON
 *
 * @example
 * const catalog = require('HarmonyCatalog');
 * let jsonObj = catalog.create(job, stacDataLinks, pagingLinks);
 * let jsonStr = JSON.stringify(jsonObj, null, 2);
 */
export default function create(
  job: Job, stacDataLinks: JobLink[], pagingLinks: JobLink[], linkType?: string,
): SerializableCatalog {
  const title = `Harmony output for ${job.jobID}`;
  const description = `Harmony output for ${job.request}`;
  const catalog = new HarmonyCatalog(job.jobID, title, description);
  // Add linkType to links if defined and not null
  const linkTypeParam = linkType ? `?linkType=${linkType}` : '';
  const url = linkType ? `./${linkTypeParam}` : '.';
  catalog.addLink(url, 'self', 'self');
  catalog.addLink(url, 'root', 'root');
  let index = 0;
  for (const link of stacDataLinks) {
    catalog.addLink(`./${index}${linkTypeParam}`, 'item', link.title);
    index++;
  }
  catalog.links.push(...pagingLinks);
  return catalog.toJSON();
}
