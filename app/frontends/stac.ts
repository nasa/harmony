const Job = require('../models/job');
const db = require('../util/db');
const { getRequestRoot } = require('../util/url');
const isUUID = require('../util/uuid');

/**
 * Make the STAC catalog object for the given Job
 *  NOTE: This is just a place-holder for Hegde's work
 *
 * @param {Job} _job A Job object representing a completed job
 * @returns {Object} The serializable Object representing the catalog fields
 */
function makeCatalog(_job) {
  return {};
}

/**
 * Express.js handler that returns a STAC catalog for a single job
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getStacCatalog(req, res) {
  const { jobId } = req.params;
  req.context.logger.info(`Get STAC catalog for job ${jobId} and user ${req.user}`);
  if (!isUUID(jobId)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobId ${jobId} is in invalid format.` });
  } else {
    try {
      await db.transaction(async (tx) => {
        const job = await Job.byUsernameAndRequestId(tx, req.user, jobId);
        if (!job) {
          res.status(404);
          res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobId}` });
        } else if (job.status === 'successful') {
          res.send(JSON.stringify(makeCatalog(job.serialize())));
        } else {
          res.status(409);
          res.json({ code: 'harmony:BadRequestError', description: `Error: Job ${jobId} is not complete` });
        }
      });
    } catch (e) {
      req.context.logger.error(e);
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve STAC catalog for job ${jobId}` });
    }
  }
}

module.exports = {
  getStacCatalog,
};
