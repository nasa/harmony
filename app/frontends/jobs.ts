import * as Job from '../models/job';
const db = require('../util/db');
const { needsStacLink } = require('../util/stac');
const { getRequestRoot } = require('../util/url');
const isUUID = require('../util/uuid');
const { getCloudAccessJsonLink, getCloudAccessShLink, getStacCatalogLink } = require('../util/links');

/**
 * Analyze the links in the job to determine what links should be returned to
 * the end user. If any of the output links point to an S3 location add
 * links documenting how to obtain in region S3 access.
 * @param {Job} job the serialized job
 * @param {string} urlRoot the root URL to be used when constructing links
 * @returns {Object} the job with appropriate links based on the type of links
 */
function _getLinksForDisplay(job, urlRoot) {
  let { links } = job;
  const dataLinks = job.getRelatedLinks('data');
  const directS3AccessLink = dataLinks.find((l) => l.href.match(/^s3:\/\/.*$/));
  if (directS3AccessLink) {
    links.unshift(getCloudAccessJsonLink(urlRoot));
    links.unshift(getCloudAccessShLink(urlRoot));
  } else {
    // Remove the S3 bucket and prefix link
    links = links.filter((link) => link.rel !== 's3-access');
  }
  if (job.status === Job.statuses.SUCCESSFUL && needsStacLink(dataLinks)) {
    links.unshift(getStacCatalogLink(urlRoot, job.jobID));
  }
  return links;
}

/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobsListing(req, res) {
  req.context.logger.info(`Get job listing for user ${req.user}`);
  try {
    const root = getRequestRoot(req);
    await db.transaction(async (tx) => {
      const listing = await Job.forUser(tx, req.user);
      const serializedJobs = listing.map((j) => {
        const serializedJob = j.serialize(root);
        serializedJob.links = _getLinksForDisplay(serializedJob, root);
        return serializedJob;
      });
      res.send(serializedJobs);
    });
  } catch (e) {
    req.context.logger.error(e);
    res.status(500);
    res.json({
      code: 'harmony:ServerError',
      description: 'Error: Internal server error trying to retrieve jobs listing' });
  }
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobID})
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobStatus(req, res) {
  const { jobID } = req.params;
  req.context.logger.info(`Get job status for job ${jobID} and user ${req.user}`);
  if (!isUUID(jobID)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobID ${jobID} is in invalid format.` });
  } else {
    try {
      await db.transaction(async (tx) => {
        const job = await Job.byUsernameAndRequestId(tx, req.user, jobID);
        if (job) {
          const urlRoot = getRequestRoot(req);
          const serializedJob = job.serialize(urlRoot);
          serializedJob.links = _getLinksForDisplay(serializedJob, urlRoot);
          res.send(serializedJob);
        } else {
          res.status(404);
          res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobID}` });
        }
      });
    } catch (e) {
      req.context.logger.error(e);
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve job status for job ${jobID}` });
    }
  }
}

module.exports = { getJobsListing, getJobStatus };
