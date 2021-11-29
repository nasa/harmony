import { Response, Request } from 'express';
import _ from 'lodash';
import { Logger } from 'winston';
import JobLink from '../models/job-link';
import log from '../util/log';
import { ServerError, RequestValidationError } from '../util/errors';
import db from '../util/db';
import { Job, JobStatus } from '../models/job';
import { validateBbox, validateTemporal } from './service-response';

interface ArgoCallbackQueryItem {
  href: string;
  type?: string; // Mime type
  rel: string;
  title?: string;
  temporal?: string;
  bbox?: number[];
}

interface ArgoCallbackQuery {
  items?: ArgoCallbackQueryItem[];
  error?: string;
  argo?: string; // This is temporary until we decide what to do with callbacks
  redirect?: string;
  status?: string;
  progress?: string; // percentage of work completed
  batchesCompleted?: string; // A number representing how many batches have been completed
  batch_count?: string; // A number representing the total number of batches
  batch_completed?: string; // "true" if the current batch completed
  post_batch_step_count?: string; // A number representing the count of steps after batch processing
}

/**
 * Helper for updating a job, given a query string provided in a callback
 *
 * Note: parameter reassignment is allowed, since it's the purpose of this function.
 *
 * @param logger - The logger associated with this request
 * @param job - The job record to update
 * @param query - The parsed query coming from a service callback
 * @throws RequestValidationError - If the callback parameters fail validation
 * @throws ServerError - If job update fails unexpectedly
 */
function updateJobFields(
  logger: Logger,
  job: Job,
  query: ArgoCallbackQuery,
): void { /* eslint-disable no-param-reassign */
  const { error, items, status, redirect, progress, batchesCompleted } = query;
  try {
    if (items && items.length > 0) {
      items.forEach((item, _index) => {
        const link = new JobLink(_.pick(item, ['href', 'type', 'rel', 'title']));
        const { bbox, temporal } = item;
        if (bbox) {
          validateBbox(bbox);
          link.bbox = bbox;
        }
        if (temporal) {
          const temporalArray = item.temporal.split(',').map((t) => Date.parse(t));
          validateTemporal(temporalArray);
          link.temporal = { start: new Date(temporalArray[0]), end: new Date(temporalArray[1]) };
        }
        link.rel = link.rel || 'data';
        job.addLink(link);
      });
    }
    if (progress) {
      if (Number.isNaN(+progress)) {
        throw new TypeError('Job is invalid: ["Job progress must be between 0 and 100"]');
      }
      job.progress = parseInt(progress, 10);
    }

    if (batchesCompleted) {
      job.batchesCompleted = parseInt(batchesCompleted, 10);
    }

    if (error) {
      job.fail(error);
    } else if (status) {
      job.updateStatus(status as JobStatus);
    } else if (redirect) {
      job.addLink(new JobLink({ href: redirect, rel: 'data' }));
    }
  } catch (e) {
    const ErrorClass = (e instanceof TypeError) ? RequestValidationError : ServerError;
    logger.error(e);
    throw new ErrorClass(e.message);
  }
}

/**
 * Express.js handler on a service-facing endpoint that receives responses
 * from argo and updates corresponding job records.
 *
 * @param req - The request sent by the service
 * @param res - The response to send to the service
 */
export default async function responseHandler(req: Request, res: Response): Promise<void> {
  const { requestId } = req.params;
  const logger = log.child({
    component: 'callback',
    application: 'backend',
    requestId,
  });

  const query = req.query as ArgoCallbackQuery;

  const trx = await db.transaction();

  const { job } = await Job.byRequestId(trx, requestId);
  if (!job) {
    await trx.rollback();
    res.status(404);
    logger.error(`Received a callback for a missing job: requestId=${requestId}`);
    res.json({ code: 404, message: 'could not find a job with the given ID' });
    return;
  }

  const { body } = req;

  try {
    const queryOverrides = {} as ArgoCallbackQuery;

    // progress update
    if (body?.batch_completed?.toLowerCase() === 'true') {
      const batchCount = parseInt(body.batch_count, 10);
      const batchProgress = job.batchesCompleted + 1;
      const postBatchStepCount = parseInt(body.post_batch_step_count, 10) || 0;
      // always hold back 1% to reserve time for the exit handler
      let progress = Math.min(100 * (batchProgress / (batchCount + postBatchStepCount)), 99);
      // don't allow negative progress
      progress = Math.max(0, progress);
      // progress must be an integer
      progress = Math.floor(progress);
      query.progress = `${progress}`;
      query.batchesCompleted = `${batchProgress}`;
    }

    // add links if provided
    if (body.items) {
      const { items } = body;
      queryOverrides.items = items.map((itemMap): ArgoCallbackQueryItem => {
        const newItem = {} as ArgoCallbackQueryItem;
        newItem.bbox = itemMap.bbox;
        newItem.temporal = itemMap.temporal;
        newItem.href = itemMap.href;
        newItem.title = itemMap.title;
        newItem.type = itemMap.type;
        newItem.rel = 'data';
        return newItem;
      });
    }

    const fields = _.merge({}, query, queryOverrides);
    delete fields.argo;
    delete fields.batch_count;
    delete fields.post_batch_step_count;
    logger.info(`Updating job ${job.id}`, { fields });

    updateJobFields(logger, job, fields);
    await job.save(trx);
    await trx.commit();
    res.status(200);
    res.send('Ok');
  } catch (e) {
    logger.error('Failed to update job');
    logger.error(e);
    await trx.rollback();
    const status = e.code || (e instanceof TypeError ? 400 : 500);
    res.status(status);
    const errorCode = (status >= 400 && status <= 499) ? 'harmony.RequestValidationError' : 'harmony.UnknownError';
    res.json({ code: errorCode, message: e.message });
  } finally {
    if (job.isComplete()) {
      const durationMs = +job.updatedAt - +job.createdAt;
      const numOutputs = job.getRelatedLinks('data').length;
      logger.info('Async job complete.', { durationMs, numOutputs, job: job.serialize() });
    }
  }
}
