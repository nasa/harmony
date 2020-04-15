"use strict";

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
 * catalog.
 * @class HarmonyCatalog
 */
export default class HarmonyCatalog {
    /**
     *
     * @param {Object} job - The Harmony Job object; id, request, and links fields are used.
     * @param {string} job.id - ID of the Harmony Job
     * @param {string} job.requestId - ID of the Harmony Request
     * @param {string} [job.request] - URL for the Harmony Request
     */
    constructor(job) {
        if (typeof job === "undefined") {
            throw "Constructor accepts Harmony Job object";
        }
        if (!job.hasOwnProperty("id") || !job.hasOwnProperty("requestId")) {
            throw "Failed to find request and job ID";
        }
        // Catalog ID = <requestID>-<jobID>
        this.id = `${job.requestId}-${job.id}`;
        this.stac_version = "0.9.0";
        this.title = `Harmony output (Request= ${job.requestId}, Job=${job.id})`;
        if (job.hasOwnProperty("request")) {
            this.description = `Harmony output for ${job.request}`;
        }
        this.links = [];
        this.addLink("./catalog.json", "self", "self", undefined);
        this.addLink("./catalog.json", "root", "root", undefined);
        if (job.hasOwnProperty("links") && (Array.isArray(job.links))){
            for(const index in job.links) {
                this.addLink("./"+index, "item", job.links[index].title, undefined)
            }
        }
    }

    /**
     *
     * @param {string} url - Link URL
     * @param {string} relType - Relation type: [self, root, item]
     * @param {string} title - Link title (human readable)
     */
    addLink(url, relType, title) {
        this.links.push({url:url, rel:relType, title:title});
    }

    /**
     * Placeholder method to support custom stringification
     */
    toJSON() {
        return this;
    }
}
