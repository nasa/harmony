import { ILengthAwarePagination } from 'knex-paginate';
import { Job, JobForDisplay, JobStatus } from '../models/job';
import { allWorkItemsNoData } from '../models/work-item';
import { keysToLowerCase } from '../util/object';
import isUUID from '../util/uuid';
import { getRequestRoot } from '../util/url';
import { ConflictError, NotFoundError, RequestValidationError } from '../util/errors';
import { getPagingLinks, getPagingParams, PagingParams } from '../util/pagination';
import JobLink, { getLinksForJob } from '../models/job-link';
import stacItemCreate from './stac-item';
import stacCatalogCreate from './stac-catalog';
import db from '../util/db';
import env from '../util/env';

/**
 * Generic handler for STAC requests
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param callback - A function that excepts a single serialized Job as its parameter
 * @param pagingParams - Used to page the STAC links or retrieve the nth link
 * @returns Resolves when the request is complete
 */
async function handleStacRequest(
  req, res, callback: (job: JobForDisplay, pagination: ILengthAwarePagination) => void, pagingParams: PagingParams, linkType?: string,
): Promise<void> {
  const { jobId } = req.params;
  if (!isUUID(jobId)) {
    throw new RequestValidationError(`jobId ${jobId} is in invalid format.`);
  }

  let job: Job = null;
  let stacDataLinks = null;
  let pagination = null;
  // get the job and its data links (using paging parameters) from database
  await db.transaction(async (tx) => {
    const jobResult = await Job.byJobID(tx, jobId);
    // eslint-disable-next-line prefer-destructuring
    job = jobResult.job;
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobId}`);
    }

    const linkResult = await getLinksForJob(
      tx, jobId, pagingParams.page, pagingParams.limit, 'data', true,
    );
    stacDataLinks = linkResult.data;
    // eslint-disable-next-line prefer-destructuring
    pagination = linkResult.pagination;
  });

  if ([JobStatus.SUCCESSFUL, JobStatus.COMPLETE_WITH_ERRORS].includes(job.status)) {
    if (stacDataLinks.length) {
      job.links = stacDataLinks;
      const urlRoot = getRequestRoot(req);
      // default to s3 links
      const lType = linkType || 's3';
      const serializedJob = job.serialize(urlRoot, lType);
      res.json(callback(serializedJob, pagination));
    } else {
      let hasDataLinks = false;
      await db.transaction(async (tx) => {
        hasDataLinks = await job.hasLinks(tx, 'data', true);
      });

      if (hasDataLinks) {
        if (req.params.itemIndex) {
          throw new RequestValidationError('STAC item index is out of bounds');
        } else {
          throw new RequestValidationError('The requested paging parameters were out of bounds');
        }
      } else if (job.status === JobStatus.SUCCESSFUL) {
        let allItemsAreNoData = false;
        await db.transaction(async (tx) => {
          allItemsAreNoData = await allWorkItemsNoData(tx, jobId);
        });

        if (allItemsAreNoData) {
          const urlRoot = getRequestRoot(req);
          const lType = linkType || 's3';
          const serializedJob = job.serialize(urlRoot, lType);
          res.json(callback(serializedJob, pagination));
        } else {
          throw new NotFoundError(`Service did not provide STAC items for job ${jobId}`);
        }
      } else {
        throw new NotFoundError(`Service did not provide STAC items for job ${jobId}`);
      }
    }
  } else {
    throw new ConflictError(`Job ${jobId} is not complete`);
  }
}

/**
 * Express.js handler that returns a STAC catalog for a single job
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next middleware function in the stack
 * @returns Resolves when the request is complete
 */
export async function getStacCatalog(req, res, next): Promise<void> {
  const keys = keysToLowerCase(req.query);
  const linkType = keys.linktype?.toLowerCase();
  try {
    const pagingParams = getPagingParams(req, env.defaultResultPageSize);
    await handleStacRequest(
      req, res,
      (job: JobForDisplay, pagination: ILengthAwarePagination) => {
        const pagingLinks = getPagingLinks(req, pagination).map((link) => new JobLink(link));
        return stacCatalogCreate(
          job.jobID, job.request, job.links, pagingLinks, linkType,
        );
      }, pagingParams,
    );
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Express.js handler that returns a STAC item for a job
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next middleware function in the stack
 * @returns Resolves when the request is complete
 */
export async function getStacItem(req, res, next): Promise<void> {
  const { itemIndex } = req.params;
  const keys = keysToLowerCase(req.query);
  const linkType = keys.linktype?.toLowerCase();
  const itemIndexInt = parseInt(itemIndex, 10);
  try {
    if (itemIndexInt === undefined) {
      throw new RequestValidationError('STAC item index should be a valid integer');
    }
    const pagingParams: PagingParams = { page: itemIndexInt + 1, limit: 1 };
    await handleStacRequest(
      req,
      res,
      (job: JobForDisplay) => stacItemCreate.apply(
        null,
        [job.jobID, job.request, job.links[0], itemIndexInt,
          linkType, job.createdAt, job.dataExpiration],
      ),
      pagingParams,
      linkType,
    );
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
