import { Response, Request } from 'express';
import _ from 'lodash';
import log from '../util/log';
import { ServerError, RequestValidationError } from '../util/errors';
import db from '../util/db';
import { Job } from '../models/job';


/**
 * Helper for updating a job, given a query string provided in a callback
 *
 * Note: parameter reassignment is allowed, since it's the purpose of this function.
 *
 * @param logger - The logger associated with this request
 * @param job - The job record to update
 * @param query - The parsed query coming from a service callback
 * @throws {RequestValidationError} If the callback parameters fail validation
 * @throws {ServerError} If job update fails unexpectedly
 */
export function updateJobFields(
  logger,
  job,
  query,
): void { /* eslint-disable no-param-reassign */
  const { error, item, status, redirect, progress } = query;
  try {
    if (item) {
      if (item.bbox) {
        const bbox = item.bbox.split(',').map(parseFloat);
        if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
          throw new TypeError('Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North');
        }
        item.bbox = bbox;
      }
      if (item.temporal) {
        const temporal = item.temporal.split(',').map((t) => Date.parse(t));
        if (temporal.length !== 2 || temporal.some(Number.isNaN)) {
          throw new TypeError('Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End');
        }
        const [start, end] = temporal.map((t) => new Date(t).toISOString());
        item.temporal = { start, end };
      }
      item.rel = item.rel || 'data';
      job.addLink(item);
    }
    if (progress) {
      if (Number.isNaN(+progress)) {
        throw new TypeError('Job record is invalid: ["Job progress must be between 0 and 100"]');
      }
      job.progress = parseInt(progress, 10);
    }

    if (error) {
      job.fail(error);
    } else if (status) {
      job.updateStatus(status);
    } else if (redirect) {
      job.addLink({ href: redirect, rel: 'data' });
      job.succeed();
    }
  } catch (e) {
    const ErrorClass = (e instanceof TypeError) ? RequestValidationError : ServerError;
    logger.error(e);
    throw new ErrorClass(e.message);
  }
}

/**
 * Express.js handler on a service-facing endpoint that receives responses
 * from backends and updates corresponding job records.
 *
 * Because this is on a different endpoint with different middleware, it receives
 * an express Request rather than a HarmonyRequest, must construct its own, does
 * not have access to EDL info, etc
 *
 * @param req - The request sent by the service
 * @param res - The response to send to the service
 */
export async function responseHandler(req: Request, res: Response): Promise<void> {
  const { requestId } = req.params;
  const logger = log.child({
    component: 'callback',
    requestId,
  });
  const trx = await db.transaction();

  const job = await Job.byRequestId(trx, requestId);
  if (!job) {
    trx.rollback();
    res.status(404);
    logger.error(`Received a callback for a missing job: requestId=${requestId}`);
    res.json({ code: 404, message: 'could not find a job with the given ID' });
    return;
  }

  try {
    updateJobFields(logger, job, req.query);
    await job.save(trx);
    await trx.commit();
    res.status(200);
    res.send('Ok');
  } catch (e) {
    await trx.rollback();
    const status = e.code || (e instanceof TypeError ? 400 : 500);
    res.status(status);
    res.json({ code: status, message: e.message });
  } finally {
    if (job.isComplete()) {
      const durationMs = +job.updatedAt - +job.createdAt;
      const numOutputs = job.getRelatedLinks('data').length;
      logger.info('Async job complete.', { durationMs, numOutputs, job: job.serialize() });
    }
  }
}
