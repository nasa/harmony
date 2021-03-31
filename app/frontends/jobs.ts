import { Response, NextFunction } from 'express';
import { Job, JobStatus, JobQuery, JobLink } from 'models/job';
import keysToLowerCase from 'util/object';
import isUUID from 'util/uuid';
import cancelAndSaveJob from 'util/job';
import { needsStacLink } from '../util/stac';
import { getRequestRoot } from '../util/url';
import { getCloudAccessJsonLink, getCloudAccessShLink, getStacCatalogLink, getStatusLink } from '../util/links';
import { RequestValidationError, NotFoundError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import env = require('../util/env');

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
 * @param linkType - the type of data link to use (http|https|s3)
 * @returns a list of job links
 */
function getLinksForDisplay(job: Job, urlRoot: string): JobLink[] {
  let { links } = job;
  const dataLinks = job.getRelatedLinks('data');
  if (containsS3DirectAccessLink(job)) {
    links.unshift(getCloudAccessJsonLink(urlRoot));
    links.unshift(getCloudAccessShLink(urlRoot));
  } else {
    // Remove the S3 bucket and prefix link
    links = links.filter((link) => link.rel !== 's3-access');
  }
  if (job.status === JobStatus.SUCCESSFUL && needsStacLink(dataLinks)) {
    links.unshift(getStacCatalogLink(urlRoot, job.jobID));
  }
  links.unshift(getStatusLink(urlRoot, job.jobID));
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
  return message;
}

/**
 * Returns a job formatted for display to an end user.
 *
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 * @returns the job for display
 */
function getJobForDisplay(job: Job, urlRoot: string, linkType?: string): Job {
  const serializedJob = job.serialize(urlRoot, linkType);
  serializedJob.links = getLinksForDisplay(serializedJob, urlRoot);
  serializedJob.message = getMessageForDisplay(serializedJob, urlRoot);
  delete serializedJob.isAsync;
  delete serializedJob.batchesCompleted;
  return serializedJob;
}

export interface JobListing {
  count: number;
  jobs: Job[];
  links: JobLink[];
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
    const root = getRequestRoot(req);
    const { page, limit } = getPagingParams(req);
    const query: JobQuery = {};
    if (!req.context.isAdminAccess) {
      query.username = req.user;
      query.isAsync = true;
    }
    let listing;
    await db.transaction(async (tx) => {
      listing = await Job.queryAll(tx, query, page, limit);
    });
    const serializedJobs = listing.data.map((j) => getJobForDisplay(j, root));
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
 * Throws an exception if the JobID is not in the valid format for a jobID.
 * @param jobID - The jobID to validate
 */
function validateJobId(jobID: string): void {
  if (!isUUID(jobID)) {
    throw new RequestValidationError(`Invalid format for Job ID '${jobID}'. Job ID must be a UUID.`);
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

    const query: JobQuery = { requestId: jobID };
    if (!req.context.isAdminAccess) {
      query.username = req.user;
    }
    let job: Job;
    await db.transaction(async (tx) => {
      const jobs = await Job.queryAll(tx, query);
      job = jobs.data[0];
    });
    if (job) {
      const urlRoot = getRequestRoot(req);
      res.send(getJobForDisplay(job, urlRoot, linkType));
    } else {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Express.js handler that cancels a single job `(POST /jobs/{jobID})`. A user can cancel their own
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
  try {
    validateJobId(jobID);
    let message: string;
    let username: string;
    const isAdmin = req.context.isAdminAccess;
    if (isAdmin) {
      message = 'Canceled by admin.';
    } else {
      message = 'Canceled by user.';
      username = req.user;
    }

    await cancelAndSaveJob(jobID, message, req.context.logger, true, username);

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
