import { Response, Request } from 'express';
import _ from 'lodash';
import { Logger } from 'winston';
import log from '../util/log';
import { ServerError, RequestValidationError } from '../util/errors';
import db from '../util/db';
import { Job, JobLink, JobStatus } from '../models/job';
import { objectStoreForProtocol } from '../util/object-store';

export interface CallbackQueryItem {
  href?: string;
  type?: string; // Mime type
  rel: string;
  title?: string;
  temporal?: string;
  bbox?: string | number[];
}

export interface CallbackQuery {
  item?: CallbackQueryItem;
  items?: CallbackQueryItem[];
  error?: string;
  argo?: string; // This is temporary until we decide what to do with callbacks
  redirect?: string;
  status?: string;
  progress?: string;
  batch_count?: string;
  batch_completed?: string;
  post_batch_step_count?: string;
}

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
function updateJobFields(
  logger: Logger,
  job: Job,
  query: CallbackQuery,
): void { /* eslint-disable no-param-reassign */
  const { error, items, status, redirect, progress } = query;
  try {
    if (items && items.length > 0) {
      items.forEach((item, _index) => {
        const link = _.pick(item, ['href', 'type', 'rel', 'title']) as JobLink;
        if (item.bbox) {
          const bbox = item.bbox instanceof String ? item.bbox.split(',').map(parseFloat) : item.bbox as number[];
          if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
            throw new TypeError('Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North');
          }
          link.bbox = bbox;
        }
        if (item.temporal) {
          const temporal = item.temporal.split(',').map((t) => Date.parse(t));
          if (temporal.length !== 2 || temporal.some(Number.isNaN)) {
            throw new TypeError('Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End');
          }
          const [start, end] = temporal.map((t) => new Date(t).toISOString());
          link.temporal = { start, end };
        }
        link.rel = link.rel || 'data';
        job.addLink(link);
      });
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
      job.updateStatus(status as JobStatus);
    } else if (redirect) {
      job.addLink({ href: redirect, rel: 'data' });
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
    application: 'backend',
    requestId,
  });

  const query = req.query as CallbackQuery;

  const trx = await db.transaction();

  const job = await Job.byRequestId(trx, requestId);
  if (!job) {
    trx.rollback();
    res.status(404);
    logger.error(`Received a callback for a missing job: requestId=${requestId}`);
    res.json({ code: 404, message: 'could not find a job with the given ID' });
    return;
  }

  const { body } = req;

  try {
    const queryOverrides = {} as CallbackQuery;

    if (!body && !query.item?.href && !query.error && req.headers['content-length'] && req.headers['content-length'] !== '0') {
      // If the callback doesn't contain a redirect or error or progress and has some content in
      // the body, assume the content is a file result.
      const stagingLocation = job.getRelatedLinks('s3-access')[0].href;

      const fileItem = {} as CallbackQueryItem;
      const store = objectStoreForProtocol(stagingLocation);
      if (req.headers['content-type'] && req.headers['content-type'] !== 'application/x-www-form-urlencoded') {
        fileItem.type = req.headers['content-type'];
      }
      let filename = query.item?.title;
      if (req.headers['content-disposition']) {
        const filenameMatch = req.headers['content-disposition'].match(/filename="([^"]+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      if (!filename) {
        throw new TypeError('Services providing output via POST body must send a filename via a "Content-Disposition" header or "fileItem[title]" query parameter');
      }
      fileItem.href = stagingLocation + filename;
      logger.info(`Staging to ${fileItem.href}`);
      await store.upload(req, fileItem.href, +req.headers['content-length'], fileItem.type || query.item?.type);
      queryOverrides.items = [fileItem];

      if (!job.isAsync) {
        queryOverrides.status = JobStatus.SUCCESSFUL;
      }
    }

    // progress update
    if (body?.batch_completed?.toLowerCase() === 'true') {
      const currentProgress = job.progress || 0;
      const batchCount = parseInt(body.batch_count, 10);
      const batchProgress = (currentProgress / 100.0) * batchCount + 1;
      const postBatchStepCount = parseInt(body.post_batch_step_count, 10) || 0;
      // always hold back 1% to reserve time for the exit handler
      const progress = 100 * (batchProgress / (batchCount + postBatchStepCount)) - 1;
      query.progress = `${progress}`;
    }

    // add links if provided
    if (body.items) {
      const items = JSON.parse(body.items);
      queryOverrides.items = items.map((itemMap): CallbackQueryItem => {
        const newItem = {} as CallbackQueryItem;
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
    if (job.isAsync && fields.status === JobStatus.SUCCESSFUL && !fields.argo) {
      // This is temporary until we decide how we want to use callbacks. We avoid updating
      // job status when the callback doesn't come from Argo
      delete fields.status;
    }
    delete fields.argo;
    delete fields.batch_count;
    delete fields.post_batch_step_count;
    logger.info(`Updating job ${job.id} with fields: ${JSON.stringify(fields)}`);

    if (!query.error && query.argo?.toLowerCase() === 'true') {
      // this is temporary until we decide how we want to use callbacks
      job.succeed();
    }

    updateJobFields(logger, job, fields);
    await job.save(trx);
    await trx.commit();
    res.status(200);
    res.send('Ok');
  } catch (e) {
    await trx.rollback();
    const status = e.code || (e instanceof TypeError ? 400 : 500);
    res.status(status);
    const errorCode = (status >= 400 && status <= 499) ? 'harmony.RequestValidationError' : 'harmony.UnknownError';
    res.json({ code: errorCode, message: e.message });
    logger.error(e);
  } finally {
    if (job.isComplete()) {
      const durationMs = +job.updatedAt - +job.createdAt;
      const numOutputs = job.getRelatedLinks('data').length;
      logger.info('Async job complete.', { durationMs, numOutputs, job: job.serialize() });
    }
  }
}
