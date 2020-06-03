import { Response } from 'express';
import { Job, JobStatus, JobQuery, JobLink } from 'models/job';
import isUUID from 'util/uuid';
import { needsStacLink } from '../util/stac';
import { getRequestRoot } from '../util/url';
import { getCloudAccessJsonLink, getCloudAccessShLink, getStacCatalogLink } from '../util/links';
import { RequestValidationError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';

/**
 * Analyze the links in the job to determine what links should be returned to
 * the end user. If any of the output links point to an S3 location add
 * links documenting how to obtain in region S3 access.
 * @param {Job} job the serialized job
 * @param {string} urlRoot the root URL to be used when constructing links
 * @returns {Object} the job with appropriate links based on the type of links
 */
function _getLinksForDisplay(job: Job, urlRoot: string): JobLink[] {
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
 */
export async function getJobsListing(req: HarmonyRequest, res: Response): Promise<void> {
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
    const serializedJobs = listing.data.map((j) => {
      const serializedJob = j.serialize(root);
      serializedJob.links = _getLinksForDisplay(serializedJob, root);
      delete serializedJob.isAsync;
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
    if (e instanceof RequestValidationError) {
      res.status(e.code);
      res.json({
        code: 'harmony:RequestValidationError',
        description: `Error: ${e.message}`,
      });
    } else {
      req.context.logger.error(e);
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: 'Error: Internal server error trying to retrieve jobs listing' });
    }
  }
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobID})
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
export async function getJobStatus(req: HarmonyRequest, res: Response): Promise<void> {
  const { jobID } = req.params;
  req.context.logger.info(`Get job status for job ${jobID} and user ${req.user}`);
  if (!isUUID(jobID)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobID ${jobID} is in invalid format.` });
  } else {
    try {
      await db.transaction(async (tx) => {
        const job = await Job.byUsernameAndRequestId(tx, req.user, jobID);
        if (job) {
          const urlRoot = getRequestRoot(req);
          const serializedJob = job.serialize(urlRoot);
          serializedJob.links = _getLinksForDisplay(serializedJob, urlRoot);
          res.send(serializedJob);
        } else {
          res.status(404);
          res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobID}` });
        }
      });
    } catch (e) {
      req.context.logger.error(e);
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve job status for job ${jobID}` });
    }
  }
}
