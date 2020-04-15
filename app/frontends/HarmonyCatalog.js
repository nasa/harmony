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
     * @param {string} job.id - ID of the Harmony Job
     * @param {string} job.requestId - ID of the Harmony Request
     * @param {string} [job.request] - URL for the Harmony Request
     * @param {Object} [job.links] - Links object in Harmony Job
     */
  constructor (job) {
    if (typeof job === 'undefined') {
      throw new TypeError('Constructor accepts Harmony Job object')
    }
    if (!Object.hasOwnProperty.call(job, 'id') || !Object.hasOwnProperty.call(job, 'requestId')) {
      throw new TypeError('Failed to find request and job ID')
    }
    // Catalog ID = <requestID>-<jobID>
    this.id = `${job.requestId}-${job.id}`
    this.stac_version = '0.9.0'
    this.title = `Harmony output (Request= ${job.requestId}, Job=${job.id})`
    if (Object.hasOwnProperty.call(job, 'request')) {
      this.description = `Harmony output for ${job.request}`
    }
    this.links = []
    this.addLink('./catalog.json', 'self', 'self', undefined)
    this.addLink('./catalog.json', 'root', 'root', undefined)
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
