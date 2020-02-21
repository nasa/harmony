const Job = require('../models/job');
const db = require('../util/db');
const { getRequestRoot } = require('../util/url');
const isUUID = require('../util/uuid');

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
      res.send(listing.map((j) => j.serialize(root)));
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
          res.send(job.serialize(getRequestRoot(req)));
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
