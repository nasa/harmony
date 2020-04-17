const Job = require('../models/job');
const db = require('../util/db');
const { needsStacLink } = require('../util/stac');
const isUUID = require('../util/uuid');
const stacItem = require('./stac-item');
const stacCatalog = require('./stac-catalog');

/**
 * Generic handler for STAC requests
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {*} callback A function that excepts a single serialized Job as its parameter
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function handleStacRequest(req, res, callback) {
  const { jobId } = req.params;
  if (!isUUID(jobId)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobId ${jobId} is in invalid format.` });
  } else {
    await db.transaction(async (tx) => {
      const job = await Job.byUsernameAndRequestId(tx, req.user, jobId);
      if (!job) {
        res.status(404);
        res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobId}` });
      } else if (job.status === 'successful') {
        if (needsStacLink(job.getRelatedLinks('data'))) {
          res.json(callback(job.serialize()));
        } else {
          res.status(501);
          res.json({ code: 'harmony:ServiceError', description: `Error: Service did not provide STAC items for job ${jobId}` });
        }
      } else {
        res.status(409);
        res.json({ code: 'harmony:BadRequestError', description: `Error: Job ${jobId} is not complete` });
      }
    });
  }
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

  try {
    await handleStacRequest(req, res, (data) => stacCatalog.create(data));
  } catch (e) {
    req.context.logger.error(e);
    res.status(500);
    res.json({
      code: 'harmony:ServerError',
      description: `Error: Internal server error trying to retrieve STAC catalog for job ${jobId}` });
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

  try {
    await handleStacRequest(req, res, (data) => stacItem.create.apply(null, [data, itemIndex]));
  } catch (e) {
    req.context.logger.error(e);
    if (e instanceof RangeError) {
      res.status(400);
      res.json({
        code: 'harmony:RequestError',
        description: e.message });
    } else {
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
