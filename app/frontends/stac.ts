import { Job } from 'models/job';
import { keysToLowerCase } from 'util/object';
import isUUID from 'util/uuid';
import { getRequestRoot } from 'util/url';
import { RequestValidationError } from 'util/errors';
import { getPagingLinks, getPagingParams, PagingParams } from 'util/pagination';
import JobLink from 'models/job-link';
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
  req, res, callback: Function, pagingParams: PagingParams, linkType?: string,
): Promise<void> {
  const { jobId } = req.params;
  if (!isUUID(jobId)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobId ${jobId} is in invalid format.` });
  } else {
    await db.transaction(async (tx) => {
      // load the job with only the requested STAC data links
      // (using paging parameters)
      const {
        job,
        pagination,
      } = await Job.byUsernameAndRequestId(
        tx, req.user, jobId, true, pagingParams.page, pagingParams.limit,
      );
      if (!job) {
        res.status(404);
        res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobId}` });
      } else if (job.status === 'successful') {
        if (job.links.length) {
          const urlRoot = getRequestRoot(req);
          // default to s3 links
          const lType = linkType || 's3';
          const serializedJob = job.serialize(urlRoot, lType);
          res.json(callback(serializedJob, pagination));
        } else if ((await job.hasStacLinks(tx))) {
          if (req.params.itemIndex) {
            throw new RangeError('STAC item index is out of bounds');
          } else {
            throw new RangeError('The requested paging parameters were out of bounds');
          }
        } else {
          res.status(501);
          res.json({ code: 'harmony:ServiceError', description: `Error: Service did not provide STAC items for job ${jobId}` });
        }
      } else {
        res.status(409);
        res.json({ code: 'harmony:BadRequestError', description: `Error: Job ${jobId} is not complete` });
      }
    });
  }
}

/**
 * Express.js handler that returns a STAC catalog for a single job
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function getStacCatalog(req, res): Promise<void> {
  const { jobId } = req.params;
  const keys = keysToLowerCase(req.query);
  const linkType = keys.linktype?.toLowerCase();
  try {
    const pagingParams = getPagingParams(req, env.defaultResultPageSize);
    await handleStacRequest(
      req, res,
      (job: Job, pagination) => {
        const pagingLinks = getPagingLinks(req, pagination).map((link) => new JobLink(link));
        return stacCatalogCreate(
          job.jobID, job.request, job.links, pagingLinks, linkType,
        );
      }, pagingParams,
    );
  } catch (e) {
    req.context.logger.error(e);
    if (e instanceof RangeError) {
      res.status(400);
      res.json({
        code: 'harmony:RequestError',
        description: `Error: ${e.message}`,
      });
    } else if (e instanceof RequestValidationError) {
      res.status(400);
      res.json({
        code: 'harmony:RequestValidationError',
        description: `Error: ${e.message}`,
      });
    } else {
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve STAC catalog for job ${jobId}` });
    }
  }
}

/**
 * Express.js handler that returns a STAC item for a job
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function getStacItem(req, res): Promise<void> {
  const { jobId, itemIndex } = req.params;
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
      (job: Job) => stacItemCreate.apply(
        null, [job.jobID, job.request, job.links[0], itemIndexInt, linkType, job.createdAt],
      ),
      pagingParams,
      linkType,
    );
  } catch (e) {
    req.context.logger.error(e);
    if (e instanceof RangeError) {
      res.status(400);
      res.json({
        code: 'harmony:RequestError',
        description: `Error: ${e.message}` });
    } else if (e instanceof RequestValidationError) {
      res.status(400);
      res.json({
        code: 'harmony:RequestValidationError',
        description: `Error: ${e.message}`,
      });
    } else {
      res.status(500);
      res.json({
        code: 'harmony:ServerError',
        description: `Error: Internal server error trying to retrieve STAC item for job ${jobId} index ${itemIndex}` });
    }
  }
}
