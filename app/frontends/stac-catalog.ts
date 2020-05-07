import pick from 'lodash.pick';
import { Job } from 'models/job';
import { linksWithStacData } from 'util/stac';

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
 * @class HarmonyCatalog
 */
class HarmonyCatalog {
  id: string;

  stac_version: string;

  title: string;

  description: string;

  links: Array<any>;

  /**
   *
   * @param {string} id - ID of the STAC Catalog
   * @param {string} title - Title of the STAC Catalog
   * @param {string} description - Description of the STAC Catalog
   */
  constructor(id, title = '', description = '') {
    this.id = id;
    this.stac_version = '0.9.0';
    this.title = title;
    this.description = description;
    this.links = [];
  }

  /**
   * Adds a member to 'links' property of a STAC Catalog
   *
   * @param {string} url - Link URL
   * @param {string} relType - Relation type: [self, root, item]
   * @param {string} title - Link title (human readable)
   *
   * @returns {void}
   */
  addLink(url, relType, title) {
    this.links.push({
      href: url,
      rel: relType,
      title,
    });
  }

  /**
   * Placeholder method to support custom stringification
   *
   * @returns {Object} - STAC Catalog JSON
   */
  toJSON() {
    const paths = ['id', 'stac_version', 'title', 'description', 'links'];
    return pick(this, paths);
  }
}

/**
 * Function to create the STAC Catalog given a Harmony Job object
 *
 * @param {any} job - Harmony Job object
 *
 * @returns {Object} - STAC Catalog JSON
 *
 * @example
 * const catalog = require('HarmonyCatalog');
 * let jsonObj = catalog.create(job);
 * let jsonStr = JSON.stringify(jsonObj, null, 2);
 */
export default function create(job: any): object {
  if (!(job instanceof Job)) {
    throw new TypeError('Constructor expects a Harmony Job object as argument');
  }
  if (!Object.hasOwnProperty.call(job, 'jobID')) {
    throw new TypeError('Failed to find job ID');
  }
  if (!Object.hasOwnProperty.call(job, 'request')) {
    throw new TypeError('Failed to find request');
  }
  const title = `Harmony output for ${(job as any).jobID}`;
  const description = `Harmony output for ${job.request}`;
  const catalog = new HarmonyCatalog((job as any).jobID, title, description);
  catalog.addLink('.', 'self', 'self');
  catalog.addLink('.', 'root', 'root');
  let index = 0;
  for (const link of linksWithStacData(job.links)) {
    catalog.addLink(`./${index}`, 'item', link.title);
    index++;
  }
  return catalog.toJSON();
}
