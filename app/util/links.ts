const { awsDefaultRegion } = require('./env');

/**
 * Returns a link to the cloud-access JSON endpoint
 *
 * @param {String} urlRoot The harmony root URL
 * @returns {Object} the link to the cloud-access JSON endpoint
 */
function getCloudAccessJsonLink(urlRoot) {
  return {
    title: `Obtain AWS access keys for in-region (${awsDefaultRegion}) S3 access to job outputs. The credentials are returned as JSON.`,
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
function getCloudAccessShLink(urlRoot) {
  return {
    title: `Obtain AWS access keys for in-region (${awsDefaultRegion}) S3 access to job outputs. The credentials are returned as a shell script that can be sourced.`,
    href: `${urlRoot}/cloud-access.sh`,
    rel: 'cloud-access-sh',
    type: 'application/x-sh',
  };
}

module.exports = { getCloudAccessJsonLink, getCloudAccessShLink };
