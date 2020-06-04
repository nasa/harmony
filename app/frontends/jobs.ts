import { Response } from 'express';
import { Job, JobStatus, JobQuery, JobLink } from 'models/job';
import isUUID from 'util/uuid';
import { needsStacLink } from '../util/stac';
import { getRequestRoot } from '../util/url';
import { getCloudAccessJsonLink, getCloudAccessShLink, getStacCatalogLink } from '../util/links';
import { RequestValidationError, NotFoundError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import { belongsToGroup } from '../util/cmr';
import env from '../util/env';

/**
 * Analyze the links in the job to determine what links should be returned to
 * the end user. If any of the output links point to an S3 location add
 * links documenting how to obtain in region S3 access.
 * @param {Job} job the serialized job
 * @param {string} urlRoot the root URL to be used when constructing links
 * @returns {Object} the job with appropriate links based on the type of links
 */
function getLinksForDisplay(job: Job, urlRoot: string): JobLink[] {
  let { links } = job;
  const dataLinks = job.getRelatedLinks('data');
  const directS3AccessLink = dataLinks.find((l) => l.href.match(/^s3:\/\/.*$/));
  if (directS3AccessLink) {
    links.unshift(getCloudAccessJsonLink(urlRoot));
    links.unshift(getCloudAccessShLink(urlRoot));
  } else {
    // Remove the S3 bucket and prefix link
    links = links.filter((link) => link.rel !== 's3-access');
  }
  if (job.status === JobStatus.SUCCESSFUL && needsStacLink(dataLinks)) {
    links.unshift(getStacCatalogLink(urlRoot, job.jobID));
  }
  return links;
}

export interface JobListing {
  count: number;
  jobs: Job[];
  links: JobLink[];
}
/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {Function} next The next function in the call chain
 * @returns {Promise<void>} Resolves when the request is complete
 */
export async function getJobsListing(
  req: HarmonyRequest, res: Response, next: Function,
): Promise<void> {
  try {
    const root = getRequestRoot(req);
    const { page, limit } = getPagingParams(req);
    const query: JobQuery = {};
    if (!req.context.isAdminAccess) {
      query.username = req.user;
    }
    let listing;
    await db.transaction(async (tx) => {
      listing = await Job.queryAll(tx, query, page, limit);
    });
    const serializedJobs = listing.data.map((j) => {
      const serializedJob = j.serialize(root);
      serializedJob.links = getLinksForDisplay(serializedJob, root);
      return serializedJob;
    });
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
 * @param jobID The jobID to validate
 */
function validateJobId(jobID: string): void {
  if (!isUUID(jobID)) {
    throw new RequestValidationError(`jobID ${jobID} is in invalid format.`);
  }
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobID})
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {Function} next The next function in the call chain
 * @returns {Promise<void>} Resolves when the request is complete
 */
export async function getJobStatus(
  req: HarmonyRequest, res: Response, next: Function,
): Promise<void> {
  const { jobID } = req.params;
  req.context.logger.info(`Get job status for job ${jobID} and user ${req.user}`);
  try {
    validateJobId(jobID);
    await db.transaction(async (tx) => {
      const job = await Job.byUsernameAndRequestId(tx, req.user, jobID);
      if (job) {
        const urlRoot = getRequestRoot(req);
        const serializedJob = job.serialize(urlRoot);
        serializedJob.links = getLinksForDisplay(serializedJob, urlRoot);
        res.send(serializedJob);
      } else {
        throw new NotFoundError(`Unable to find job ${jobID}`);
      }
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobID})
 *
 * @param req The request sent by the client
 * @param res The response to send to the client
 * @param next The next function in the call chain
 * @returns {Promise<void>} Resolves when the request is complete
 */
export async function cancelJob(req: HarmonyRequest, res: Response, next: Function): Promise<void> {
  const { jobID } = req.params;
  req.context.logger.info(`Cancel requested for job ${jobID} by user ${req.user}`);
  const isAdmin = await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
  try {
    validateJobId(jobID);
    let job: Job;
    let message;
    await db.transaction(async (tx) => {
      if (isAdmin) {
        job = await Job.byRequestId(tx, jobID);
        // An admin canceling their own request should be marked as canceled by user.
        if (job && job.username === req.user) {
          message = 'Canceled by user.';
        } else {
          message = 'Canceled by admin.';
        }
      } else {
        job = await Job.byUsernameAndRequestId(tx, req.user, jobID);
        message = 'Canceled by user.';
      }
      if (job) {
        job.updateStatus(JobStatus.CANCELED, message);
        await job.save(tx);
        const urlRoot = getRequestRoot(req);
        res.redirect(`${urlRoot}/jobs/${jobID}`);
      } else {
        throw new NotFoundError(`Unable to find job ${jobID}`);
      }
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
