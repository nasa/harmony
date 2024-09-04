import { Response, Request } from 'express';
import _ from 'lodash';
import { Logger } from 'winston';
import JobLink from '../models/job-link';
import log from '../util/log';
import { ServerError, RequestValidationError } from '../util/errors';
import db from '../util/db';
import { Job, JobStatus } from '../models/job';
import { objectStoreForProtocol } from '../util/object-store';

export interface CallbackQueryItem {
  href: string;
  type?: string; // Mime type
  rel: string;
  title?: string;
  temporal?: string;
  bbox?: string;
}

export interface CallbackQuery {
  item?: CallbackQueryItem;
  error?: string;
  httpBackend?: string; // This is temporary until we decide what to do with callbacks
  redirect?: string;
  status?: string;
  progress?: string;
}

/**
 *  Validate that an array is a valid bounding box, i.e., consists of four numbers
 * @param bbox - A bounding box
 */
export function validateBbox(bbox: number[]): void {
  // eslint-disable-next-line no-restricted-globals
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    throw new TypeError('Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North');
  }
}

/**
 * Validate that an array contains two valid date strings
 * @param temporal - An array containing two RFC-3339 strings (start and end datetime)
 */
export function validateTemporal(temporal: number[]): void {
  // eslint-disable-next-line no-restricted-globals
  if (temporal.length !== 2 || temporal.some(isNaN)) {
    throw new TypeError('Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End');
  }
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
export function updateJobFields(
  logger: Logger,
  job: Job,
  query: CallbackQuery,
): void { /* eslint-disable no-param-reassign */
  const { error, item, status, redirect, progress } = query;
  try {
    if (item) {
      const link = new JobLink(_.pick(item, ['href', 'type', 'rel', 'title']));
      if (item.bbox) {
        const bbox = item.bbox.split(',').map(parseFloat);
        validateBbox(bbox);
        link.bbox = bbox;
      }
      if (item.temporal) {
        const temporal = item.temporal.split(',').map((t) => Date.parse(t));
        validateTemporal(temporal);
        link.temporal = { start: new Date(temporal[0]), end: new Date(temporal[1]) };
      }
      link.rel = link.rel || 'data';
      job.addLink(link);
    }
    if (progress) {
      if (Number.isNaN(+progress)) {
        throw new TypeError('Job is invalid: ["Job progress must be between 0 and 100"]');
      }
      job.progress = parseInt(progress, 10);
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
  const startTime = new Date().getTime();
  const { requestId } = req.params;
  const logger = log.child({
    component: 'callback',
    application: 'backend',
    requestId,
  });

  const query = req.query as CallbackQuery;

  const trx = await db.transaction();

  const { job } = await Job.byJobID(trx, requestId, true, false, 1, 1);
  if (!job) {
    await trx.rollback();
    res.status(404);
    logger.error(`Received a callback for a missing job: requestId=${requestId}`);
    res.json({ code: 404, message: 'could not find a job with the given ID' });
    return;
  }

  try {
    const queryOverrides = {} as CallbackQuery;
    if (!query.item?.href && !query.error && req.headers['content-length'] && req.headers['content-length'] !== '0') {
      // If the callback doesn't contain a redirect or error and has some content in the body,
      // assume the content is a file result.
      const stagingLocation = job.getRelatedLinks('s3-access')[0].href;

      const item = {} as CallbackQueryItem;
      const store = objectStoreForProtocol(stagingLocation);
      if (req.headers['content-type'] && req.headers['content-type'] !== 'application/x-www-form-urlencoded') {
        item.type = req.headers['content-type'];
      }
      let filename = query.item?.title;
      if (req.headers['content-disposition']) {
        const filenameMatch = req.headers['content-disposition'].match(/filename="([^"]+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      if (!filename) {
        throw new TypeError('Services providing output via POST body must send a filename via a "Content-Disposition" header or "item[title]" query parameter');
      }
      item.href = stagingLocation + filename;
      logger.info(`Staging to ${item.href}`);
      await store.upload(req, item.href, +req.headers['content-length'], item.type || query.item?.type);
      queryOverrides.item = item;

      if (!job.isAsync) {
        queryOverrides.status = JobStatus.SUCCESSFUL;
      }
    }

    const fields = _.merge({}, query, queryOverrides);
    if (job.isAsync && fields.status === JobStatus.SUCCESSFUL && !fields.httpBackend) {
      // This is temporary until we decide how we want to use callbacks. We avoid updating
      // job status when the callback doesn't come from an HTTP backend
      delete fields.status;
    }
    delete fields.httpBackend;
    logger.info(`Updating job ${job.id}`, { fields });

    if (!query.error && query.httpBackend?.toLowerCase() === 'true') {
      // this is temporary until we decide how we want to use callbacks
      job.succeed();
    }
    updateJobFields(logger, job, fields);
    await job.save(trx);
    await trx.commit();

    const durationMs = new Date().getTime() - startTime;
    logger.info('timing.backend-request.end', { durationMs });

    res.status(200);
    res.send('Ok');
  } catch (e) {
    await trx.rollback();
    const status = e.statusCode || (e instanceof TypeError ? 400 : 500);
    res.status(status);
    const errorCode = (status >= 400 && status <= 499) ? 'harmony.RequestValidationError' : 'harmony.UnknownError';
    res.json({ code: errorCode, message: e.message });
    logger.error(e);
  } finally {
    if (job.hasTerminalStatus()) {
      const durationMs = +job.updatedAt - +job.createdAt;
      const numOutputs = job.getRelatedLinks('data').length;
      logger.info('timing.job-execution.end', { durationMs, numOutputs, job: job.serialize() });
    }
  }
}
