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
 * catalog = new HarmonyCatalog(job);
 * jsonObj = catalog.toJSON();
 * jsonStr = JSON.stringify(catalog, null, 2);
 * @class HarmonyCatalog
 */
export default class HarmonyCatalog {
  /**
     *
     * @param {Object} job - The Harmony Job object; id, request, and links fields are used.
     * @param {string} job.jobID - ID of the Harmony Job
     * @param {string} [job.request] - URL for the Harmony Request
     * @param {Object} [job.links] - Links object in Harmony Job
     */
  constructor (job) {
    if (typeof job === 'undefined') {
      throw new TypeError('Constructor accepts Harmony Job object')
    }
    if (!Object.hasOwnProperty.call(job, 'jobID')) {
      throw new TypeError('Failed to find job ID')
    }
    // Catalog ID = <jobID>
    this.id = `${job.jobID}`
    this.stac_version = '0.9.0'
    this.title = `Harmony output for ${job.jobID}`
    if (Object.hasOwnProperty.call(job, 'request')) {
      this.description = `Harmony output for ${job.request}`
    }
    this.links = []
    this.addLink('./catalog.json', 'self', 'self')
    this.addLink('./catalog.json', 'root', 'root')
    if (Object.hasOwnProperty.call(job, 'links') && (Array.isArray(job.links))) {
      for (const index in job.links) {
        this.addLink(`./${index}`, 'item', job.links[index].title)
      }
    }
  }

  /**
     *
     * @param {string} url - Link URL
     * @param {string} relType - Relation type: [self, root, item]
     * @param {string} title - Link title (human readable)
     */
  addLink (url, relType, title) {
    this.links.push({ url: url, rel: relType, title: title })
  }

  /**
     * Placeholder method to support custom stringification
     */
  toJSON () {
    return this
  }
}
