const Job = require('../models/job');
const db = require('../util/db');
const { needsStacLink } = require('../util/stac');
const isUUID = require('../util/uuid');
const stacItem = require('./stac-item');
const stacCatalog = require('./stac-catalog');

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
          if (needsStacLink(job.getRelatedLinks('data'))) {
            res.send(JSON.stringify(stacCatalog.create(job.serialize())));
          } else {
            res.status(501);
            res.json({ code: 'harmony:ServiceError', description: `Error: Service did not provide STAC items for job ${jobId}` });
          }
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

/**
 * Express.js handler that returns a STAC item for a job
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getStacItem(req, res) {
  const { jobId, itemIndex } = req.params;
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
          if (needsStacLink(job.getRelatedLinks('data'))) {
            res.send(JSON.stringify(stacItem.create(job.serialize(), itemIndex)));
          } else {
            res.status(501);
            res.json({ code: 'harmony:ServiceError', description: `Error: Service did not provide STAC items for job ${jobId}` });
          }
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
        description: `Error: Internal server error trying to retrieve STAC item for job ${jobId} index ${itemIndex}` });
    }
  }
}

module.exports = {
  getStacCatalog,
  getStacItem,
};
