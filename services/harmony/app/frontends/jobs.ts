import { NextFunction, Response } from 'express';
import _ from 'lodash';
import { Logger } from 'winston';

import HarmonyRequest from '../models/harmony-request';
import { Job, JobForDisplay, JobQuery } from '../models/job';
import JobLink from '../models/job-link';
import JobMessage, { getMessagesForJob } from '../models/job-message';
import db from '../util/db';
import { isAdminUser } from '../util/edl-api';
import env from '../util/env';
import { NotFoundError, RequestValidationError, ServerError } from '../util/errors';
import {
  cancelAndSaveJob, getJobForDisplay, jobStatusCache, pauseAndSaveJob, resumeAndSaveJob,
  skipPreviewAndSaveJob, validateJobId,
} from '../util/job';
import { Link } from '../util/links';
import { keysToLowerCase } from '../util/object';
import { getPagingLinks, getPagingParams, setPagingHeaders } from '../util/pagination';
import { getRequestRoot } from '../util/url';

export interface JobListing {
  count: number;
  jobs: JobForDisplay[];
  links: Link[];
}
/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getJobsListing(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    req.context.logger.info(`Get jobs listing for user ${req.user}`);
    const root = getRequestRoot(req);
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize);
    const query: JobQuery = { where: {}, orderBy: { field: 'jobs.id', value: 'desc' } };
    query.labels = req.body.label;

    if (!req.context.isAdminAccess) {
      query.where.username = req.user;
    }

    let listing;
    await db.transaction(async (tx) => {
      listing = await Job.queryAll(tx, query, page, limit, true);
    });
    const serializedJobs = listing.data.map((j) => getJobForDisplay(j, root, 'none', []));
    const response: JobListing = {
      count: listing.pagination.total,
      jobs: serializedJobs,
      links: getPagingLinks(req, listing.pagination),
    };
    setPagingHeaders(res, listing.pagination);
    res.json(response);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Get a message explaining the change in size from the input to the output
 *
 * @param sizes - original and output sizes of the input in MiB (1024 x 1024 bytes)
 * @param precision - the number of decimal places to allow in the output
 * @returns a message explaining the size change as a percentage
 */
export function sizeChangeMessage(
  sizes: { originalSize: number; outputSize: number; },
  precision: number = 2): string {
  if (sizes.originalSize === 0) {
    return 'Original size is 0 - percent size change N/A';
  }
  if (sizes.outputSize === 0) {
    return 'Output size is 0 - percent size change N/A';
  }
  let result: string;
  const diff = sizes.originalSize - sizes.outputSize;
  if (diff < 0) {
    const percent = (-diff / sizes.originalSize * 100.0).toFixed(precision);
    result = `${percent}% increase`;
  } else if (diff > 0) {
    let percent = (diff / sizes.originalSize * 100.0).toFixed(precision);
    // due to JS precision issues, big changes will appear to be 100% reduction, which is impossible
    if (percent === 100.0.toFixed(precision)) percent = 99.99.toFixed(precision);

    result = `${percent}% reduction`;
  } else {
    result = 'no change';
  }

  return result;
}

/**
 * Format a data size number as a string for human presentation
 * @param mibSize - the float size in MiB (1024x1024 bytes)
 * @param precision - the number of decimal places to allow in the output
 * @returns a string representing the size using B, KiB, MiB, etc., notation
 */
export function formatDataSize(mibSize: number, precision: number = 2): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let size = mibSize * 1024 * 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

/**
 * Express.js handler that returns job status for a single job `(/jobs/{jobID})`
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getJobStatus(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  const keys = keysToLowerCase(req.query);
  const linkType = keys.linktype?.toLowerCase();
  req.context.logger.info(`Get job status for job ${jobID} and user ${req.user}`);
  try {
    validateJobId(jobID);
    const cachedStatus = jobStatusCache.get(jobID);
    if (cachedStatus) {
      req.context.logger.debug(`Using cached job status for ${jobID}`);
      // Make sure the next time job status is requested we get it from the database.
      // We only cache it so that it can be retrieved quickly from the first redirect
      // when creating the request.
      jobStatusCache.delete(jobID);
      res.send(cachedStatus);
      return;
    }
    const { page, limit } = getPagingParams(req, env.defaultResultPageSize);
    const { job, pagination } = await Job.byJobID(db, jobID, true, true, false, page, limit);
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
    const messages: JobMessage[] = await getMessagesForJob(db, jobID);
    const isAdmin = await isAdminUser(req);
    const isAdminOrOwner = job.belongsToOrIsAdmin(req.user, isAdmin);
    const isJobShareable = await job.isShareable(req.accessToken);
    if (!isAdminOrOwner && !isJobShareable) {
      throw new NotFoundError();
    }
    const urlRoot = getRequestRoot(req);
    const pagingLinks = getPagingLinks(req, pagination).map((link) => new JobLink(link));
    job.links = job.links.concat(pagingLinks);
    const jobForDisplay = getJobForDisplay(job, urlRoot, linkType, messages);
    if (job.original_data_size && job.output_data_size) {
      jobForDisplay.originalDataSize = formatDataSize(job.original_data_size);
      jobForDisplay.outputDataSize = formatDataSize(job.output_data_size);
      jobForDisplay.dataSizePercentChange =
        sizeChangeMessage({ originalSize: job.original_data_size, outputSize: job.output_data_size });
    }
    res.send(jobForDisplay);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Helper function for canceling, pausing, or resuming jobs
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @param jobFn - The function to call to change the job state
 */
export async function changeJobState(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
  jobFn: (jobID: string, logger: Logger, username: string, token: string) => Promise<void>,
): Promise<void> {
  try {
    const { jobID } = req.params;
    validateJobId(jobID);
    let username: string;

    if (!req.context.isAdminAccess) {
      username = req.user;
    }

    await jobFn(jobID, req.context.logger, username, req.accessToken);

    if (req.context.isAdminAccess) {
      res.redirect(`/admin/jobs/${jobID}`);
    } else {
      res.redirect(`/jobs/${jobID}`);
    }
  } catch (e) {
    req.context.logger.error(e);
    if (e instanceof TypeError) {
      next(new RequestValidationError(e.message));
    } else {
      next(e);
    }
  }
}

/**
 * Helper function for canceling, pausing, or resuming jobs in a batch
 *
 * @param req - The request sent by the client
 * @param next - The next function in the call chain
 * @param jobFn - The function to call to change the job state
 */
export async function changeJobsState(
  req: HarmonyRequest,
  next: NextFunction,
  jobFn: (jobID: string, logger: Logger, username: string, token: string) => Promise<void>,
): Promise<void> {
  let processedCount = 0;
  try {
    const { jobIDs } = req.body;
    let username: string;
    const isAdmin = await isAdminUser(req);
    if (!isAdmin) {
      // undefined username => admin=true
      username = req.user;
    }
    for (const jobID of jobIDs) {
      validateJobId(jobID);
      await jobFn(jobID, req.context.logger, username, req.accessToken);
      processedCount += 1;
    }
  } catch (e) {
    const message = `Could not change all job statuses. Proccessed ${processedCount}.`;
    next(new ServerError(message));
  }
}

/**
 * Express.js handler that cancels a single job `(POST /jobs/{jobID}/cancel)`. A user can cancel their own
 * request. An admin can cancel any user's request.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function cancelJob(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  req.context.logger.info(`Cancel requested for job ${jobID} by user ${req.user}`);
  await changeJobState(req, res, next, cancelAndSaveJob);
}

/**
 * Express.js handler that resumes a single job `(POST /jobs/{jobID}/resume)`.
 * A user can resume their own request. An admin can resume any user's request.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function resumeJob(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Resume requested for job ${req.params.jobID} by user ${req.user}`);
  await changeJobState(req, res, next, resumeAndSaveJob);
}

/**
 * Express.js handler that skips the preview of a single job and goes straight to 'running'
 *  `(POST /jobs/{jobID}/resume)`.
 * A user can skip preview of their own request. An admin can skip preview any user's request.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function skipJobPreview(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Skip preview requested for job ${req.params.jobID} by user ${req.user}`);
  await changeJobState(req, res, next, skipPreviewAndSaveJob);
}

/**
 * Express.js handler that pauses a single job `(POST /jobs/{jobID}/pause)`.
 * A user can pause their own request. An admin can pause any user's request.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function pauseJob(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Pause requested for job ${req.params.jobID} by user ${req.user}`);
  await changeJobState(req, res, next, pauseAndSaveJob);
}

/**
 * Express.js handler that cancels jobs.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function cancelJobs(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Cancel requested for jobs ${req.body.jobIDs} by user ${req.user}`);
  await changeJobsState(req, next, cancelAndSaveJob);
  res.status(200).json({ status: 'canceled' });
}

/**
 * Express.js handler that resumes jobs.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function resumeJobs(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Resume requested for jobs ${req.body.jobIDs} by user ${req.user}`);
  await changeJobsState(req, next, resumeAndSaveJob);
  res.status(200).json({ status: 'running' });
}

/**
 * Express.js handler that skips the preview of jobs.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function skipJobsPreview(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Skip preview requested for jobs ${req.body.jobIDs} by user ${req.user}`);
  await changeJobsState(req, next, skipPreviewAndSaveJob);
  res.status(200).json({ status: 'running' });
}

/**
 * Express.js handler that pauses jobs.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function pauseJobs(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Pause requested for jobs ${req.body.jobIDs} by user ${req.user}`);
  await changeJobsState(req, next, pauseAndSaveJob);
  res.status(200).json({ status: 'paused' });
}