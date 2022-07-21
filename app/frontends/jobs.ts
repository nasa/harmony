import { Response, NextFunction } from 'express';
import { Logger } from 'winston';
import { Job, JobStatus, JobQuery } from '../models/job';
import { keysToLowerCase } from '../util/object';
import { cancelAndSaveJob, pauseAndSaveJob, resumeAndSaveJob, skipPreviewAndSaveJob, validateJobId } from '../util/job';
import JobLink from '../models/job-link';
import { needsStacLink } from '../util/stac';
import { getRequestRoot } from '../util/url';
import { getCloudAccessJsonLink, getCloudAccessShLink, getJobStateChangeLinks, getStacCatalogLink, getStatusLink, Link } from '../util/links';
import { RequestValidationError, NotFoundError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import env = require('../util/env');
import JobError, { getErrorsForJob } from '../models/job-error';
import _ from 'lodash';

/**
 * Returns true if the job contains S3 direct access links
 *
 * @param job - the serialized job
 * @returns true if job contains S3 direct access links and false otherwise
 */
function containsS3DirectAccessLink(job: Job): boolean {
  const dataLinks = job.getRelatedLinks('data');
  return dataLinks.some((l) => l.href.match(/^s3:\/\/.*$/));
}

/**
 * Analyze the links in the job to determine what links should be returned to
 * the end user. If any of the output links point to an S3 location add
 * links documenting how to obtain in region S3 access.
 *
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 * @param statusLinkRel - the type of relation (self|item) for the status link
 * @returns a list of job links
 */
function getLinksForDisplay(job: Job, urlRoot: string, statusLinkRel: string): JobLink[] {
  let { links } = job;
  const dataLinks = job.getRelatedLinks('data');
  if (containsS3DirectAccessLink(job)) {
    links.unshift(new JobLink(getCloudAccessJsonLink(urlRoot)));
    links.unshift(new JobLink(getCloudAccessShLink(urlRoot)));
  } else {
    // Remove the S3 bucket and prefix link
    links = links.filter((link) => link.rel !== 's3-access');
  }
  if (job.status === JobStatus.SUCCESSFUL && needsStacLink(dataLinks)) {
    links.unshift(new JobLink(getStacCatalogLink(urlRoot, job.jobID)));
  }
  // add cancel, pause, resume, etc. links if applicable
  links.unshift(...getJobStateChangeLinks(job, urlRoot));
  // add a 'self' or 'item' link if it does not already exist
  // 'item' is for use in jobs listings, 'self' for job status
  if (links.filter((link) => link.rel === 'self').length === 0) {
    links.unshift(new JobLink(getStatusLink(urlRoot, job.jobID, statusLinkRel)));
  }

  return links;
}

/**
 * Determines the message that should be displayed to an end user based on
 * the links within the job
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 */
function getMessageForDisplay(job: Job, urlRoot: string): string {
  let { message } = job;
  if (containsS3DirectAccessLink(job)) {
    if (!message.endsWith('.')) {
      message += '.';
    }
    message += ' Contains results in AWS S3. Access from AWS '
      + `${env.awsDefaultRegion} with keys from ${urlRoot}/cloud-access.sh`;
  }
  if (job.status === JobStatus.PAUSED) {
    message += '. The job may be resumed using the provided link.';
  }
  return message;
}

/**
 * Returns a job formatted for display to an end user.
 *
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 * @param linkType - the type to use for data links (http|https|s3|none)
 * @param errors - a list of errors for the job
 * @returns the job for display
 */
function getJobForDisplay(job: Job, urlRoot: string, linkType?: string, errors?: JobError[]): Job {
  const serializedJob = job.serialize(urlRoot, linkType);
  const statusLinkRel = linkType === 'none' ? 'item' : 'self';
  serializedJob.links = getLinksForDisplay(serializedJob, urlRoot, statusLinkRel);
  serializedJob.message = getMessageForDisplay(serializedJob, urlRoot);

  if (errors.length > 0) {
    serializedJob.errors =  errors.map((e) => _.pick(e, ['url', 'message'])) as unknown as JobError[];
  }

  return serializedJob;
}

export interface JobListing {
  count: number;
  jobs: Job[];
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
    const query: JobQuery = { where: {} };
    if (!req.context.isAdminAccess) {
      query.where.username = req.user;
      query.where.isAsync = true;
    }
    let listing;
    await db.transaction(async (tx) => {
      listing = await Job.queryAll(tx, query, false, page, limit);
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
    const { page, limit } = getPagingParams(req, env.defaultResultPageSize);
    let job: Job;
    let pagination;
    let errors: JobError[];

    await db.transaction(async (tx) => {
      ({ job, pagination } = await Job.byRequestId(tx, jobID, page, limit));
      errors = await getErrorsForJob(tx, jobID);
    });
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
    if (!(await job.canShareResultsWith(req.user, req.context.isAdminAccess, req.accessToken))) {
      throw new NotFoundError();
    }
    const urlRoot = getRequestRoot(req);
    const pagingLinks = getPagingLinks(req, pagination).map((link) => new JobLink(link));
    job.links = job.links.concat(pagingLinks);
    res.send(getJobForDisplay(job, urlRoot, linkType, errors));
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