import env = require('./env');

const { awsDefaultRegion } = env;

export interface Link {
  href: string;
  title: string;
  rel: string;
  type: string;
}

/**
 * Returns a link to the cloud-access JSON endpoint
 *
 * @param {String} urlRoot The harmony root URL
 * @returns {Object} the link to the cloud-access JSON endpoint
 */
export function getCloudAccessJsonLink(urlRoot: string): Link {
  return {
    title: `Access keys for s3:// URLs, usable from AWS ${awsDefaultRegion} (JSON format)`,
    href: `${urlRoot}/cloud-access`,
    rel: 'cloud-access-json',
    type: 'application/json',
  };
}

/**
 * Returns a link to the cloud-access shell script endpoint
 *
 * @param {String} urlRoot The harmony root URL
 * @returns {Object} the link to the cloud-access shell script endpoint
 */
export function getCloudAccessShLink(urlRoot: string): Link {
  return {
    title: `Access keys for s3:// URLs, usable from AWS ${awsDefaultRegion} (Shell format)`,
    href: `${urlRoot}/cloud-access.sh`,
    rel: 'cloud-access-sh',
    type: 'application/x-sh',
  };
}

/**
 * Returns a link to the STAC catalog for the given job
 *
 * @param {string} urlRoot The harmony root URL
 * @param {string} jobID The UUID of the job
 * @returns {Object} the link to the STAC catalog
 */
export function getStacCatalogLink(urlRoot: string, jobID: string): Link {
  return {
    title: 'STAC catalog',
    href: `${urlRoot}/stac/${jobID}/`,
    rel: 'stac-catalog-json',
    type: 'application/json',
  };
}

/**
 * Returns a link to the status page for the job
 *
 * @param {string} urlRoot The harmony root URL
 * @param {string} jobID The UUID of the job
 * @returns {Object} the link to the STAC catalog
 */
export function getStatusLink(urlRoot: string, jobID: string): Link {
  return {
    title: 'Job Status',
    href: `${urlRoot}/jobs/${jobID}`,
    rel: 'self',
    type: 'application/json',
  };
}
