const pick = require('lodash.pick');
const Job = require('../models/job');
const db = require('../util/db');
const { getRequestRoot } = require('../util/url');
const isUUID = require('../util/uuid');
const { createPublicPermalink } = require('./service-results');

const serializedJobFields = [
  'requestId', 'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links'];

/**
 * Serializes a Job to return from job listing and status endpoints
 * @param {Job} job the job
 * @param {string} urlRoot the root URL to be used when constructing links
 * @returns {Object} an object with the serialized job fields.
 */
function _serializeJob(job, urlRoot) {
  const serializedJob = pick(job, serializedJobFields);
  serializedJob.updatedAt = new Date(serializedJob.updatedAt);
  serializedJob.createdAt = new Date(serializedJob.createdAt);
  serializedJob.jobID = serializedJob.requestId;

  serializedJob.links = serializedJob.links.map((link) => ({
    href: createPublicPermalink(link.href, urlRoot),
    title: link.title,
    type: link.type,
  }));

  delete serializedJob.requestId;
  return serializedJob;
}

/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobsListing(req, res) {
  req.logger.info(`Get job listing for user ${req.user}`);
  try {
    const root = getRequestRoot(req);
    await db.transaction(async (tx) => {
      const listing = await Job.forUser(tx, req.user);
      res.send(listing.map((j) => _serializeJob(j, root)));
    });
  } catch (e) {
    req.logger.error(e);
    res.status(500);
    res.json({
      code: 'harmony:ServerError',
      description: 'Error: Internal server error trying to retrieve jobs listing' });
  }
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobId})
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobStatus(req, res) {
  const { jobId } = req.params;
  req.logger.info(`Get job status for job ${jobId} and user ${req.user}`);
  if (!isUUID(jobId)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobId ${jobId} is in invalid format.` });
  } else {
    try {
      await db.transaction(async (tx) => {
        const job = await Job.byUsernameAndRequestId(tx, req.user, jobId);
        if (job) {
          res.send(_serializeJob(job, getRequestRoot(req)));
        } else {
          res.status(404);
          res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobId}` });
        }
      });
    } catch (e) {
      req.logger.error(e);
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve job status for job ${jobId}` });
    }
  }
}

module.exports = { getJobsListing, getJobStatus };
