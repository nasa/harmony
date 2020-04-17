const pick = require('lodash.pick');
const HarmonyJob = require('../models/job');
const {
  linksWithStacData,
} = require('../util/stac');


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
 * @param {Job} job - Harmony Job object
 *
 * @returns {Object} - STAC Catalog JSON
 *
 * @example
 * const catalog = require('HarmonyCatalog');
 * let jsonObj = catalog.create(job);
 * let jsonStr = JSON.stringify(jsonObj, null, 2);
 */
function create(job) {
  if (!(job instanceof HarmonyJob)) {
    throw new TypeError('Constructor expects a Harmony Job object as argument');
  }
  if (!Object.hasOwnProperty.call(job, 'jobID')) {
    throw new TypeError('Failed to find job ID');
  }
  if (!Object.hasOwnProperty.call(job, 'request')) {
    throw new TypeError('Failed to find request');
  }
  const title = `Harmony output for ${job.jobID}`;
  const description = `Harmony output for ${job.request}`;
  const catalog = new HarmonyCatalog(job.jobID, title, description);
  catalog.addLink('.', 'self', 'self');
  catalog.addLink('.', 'root', 'root');
  let index = 0;
  for (const link of linksWithStacData(job.links)) {
    catalog.addLink(`./${index}`, 'item', link.title);
    index++;
  }
  return catalog.toJSON();
}

module.exports.create = create;
