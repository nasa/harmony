import _ from 'lodash';
import { LRUCache } from 'lru-cache';
import { Logger } from 'winston';

import DataOperation, { CURRENT_SCHEMA_VERSION } from '../models/data-operation';
import { getRelatedLinks, Job, JobForDisplay, JobStatus, terminalStates } from '../models/job';
import JobLink from '../models/job-link';
import JobMessage, { JobMessageLevel } from '../models/job-message';
import {
  deleteUserWorkForJob, recalculateReadyCount, setReadyCountToZero,
} from '../models/user-work';
import { getTotalWorkItemSizesForJobID, updateWorkItemStatusesByJobId } from '../models/work-item';
import { WorkItemStatus } from '../models/work-item-interface';
import { getWorkflowStepByJobIdStepIndex, getWorkflowStepsByJobId } from '../models/workflow-steps';
import { createDecrypter, createEncrypter } from './crypto';
import db, { Transaction } from './db';
import env from './env';
import { ConflictError, ForbiddenError, NotFoundError, RequestValidationError } from './errors';
import {
  getCloudAccessJsonLink, getCloudAccessShLink, getJobStateChangeLinks, getStacCatalogLink,
  getStatusLink,
} from './links';
import { getProductMetric, getResponseMetric } from './metrics';
import { needsStacLink } from './stac';
import isUUID from './uuid';

// In memory cache for Job ID to job. This is used to speed up the initial request which redirects
// to the status page. We already have all the job information at the time so we can avoid that
// extra lookup to the database if the same instance serves the redirect as the one that created the
// request. We don't want stale job status to ever be returned so make sure the TTL is extremely short,
// ideally only a few seconds.
export const jobStatusCache = new LRUCache({
  ttl: env.jobStatusCacheTtl,
  maxSize: env.jobStatusCacheSize,
  sizeCalculation: (value: string): number => value.length,
});

/**
 * Returns true if the job contains S3 direct access links
 *
 * @param job - the serialized job
 * @returns true if job contains S3 direct access links and false otherwise
 */
function containsS3DirectAccessLink(job: JobForDisplay): boolean {
  const dataLinks = getRelatedLinks('data', job.links);
  return dataLinks.some((l) => l.href.match(/^s3:\/\/.*$/));
}

/**
 * Determines the message that should be displayed to an end user based on
 * the links within the job
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 */
function getMessageForDisplay(job: JobForDisplay, urlRoot: string): string {
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
 * Analyze the links in the job to determine what links should be returned to
 * the end user. If any of the output links point to an S3 location add
 * links documenting how to obtain in region S3 access.
 *
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 * @param statusLinkRel - the type of relation (self|item) for the status link
 * @param destinationUrl - the destinationUrl of the job
 * @returns a list of job links
 */
function getLinksForDisplay(job: JobForDisplay, urlRoot: string, statusLinkRel: string, destinationUrl: string): JobLink[] {
  let { links } = job;
  const dataLinks = getRelatedLinks('data', job.links);
  if (containsS3DirectAccessLink(job)) {
    if (!destinationUrl) {
      links.unshift(new JobLink(getCloudAccessJsonLink(urlRoot)));
      links.unshift(new JobLink(getCloudAccessShLink(urlRoot)));
    }
  } else {
    // Remove the S3 bucket and prefix link
    links = links.filter((link) => link.rel !== 's3-access');
  }
  if ([JobStatus.SUCCESSFUL, JobStatus.COMPLETE_WITH_ERRORS].includes(job.status) && needsStacLink(dataLinks)) {
    links.unshift(new JobLink(getStacCatalogLink(urlRoot, job.jobID)));
  }
  // add cancel, pause, resume, etc. links if applicable
  links.unshift(...getJobStateChangeLinks(job, urlRoot));
  // add a 'self' or 'item' link if it does not already exist
  // 'item' is for use in jobs listings, 'self' for job status
  if (links.filter((link) => link.rel === 'self').length === 0) {
    links.push(new JobLink(getStatusLink(urlRoot, job.jobID, statusLinkRel)));
  }

  return links;
}

/**
 * Returns a job formatted for display to an end user.
 *
 * @param job - the serialized job
 * @param urlRoot - the root URL to be used when constructing links
 * @param linkType - the type to use for data links (http|https|s3|none)
 * @param messages - a list of messages for the job
 * @returns the job for display
 */
export function getJobForDisplay(job: Job, urlRoot: string, linkType?: string, messages?: JobMessage[]): JobForDisplay {
  const serializedJob = job.serialize(urlRoot, linkType);
  const statusLinkRel = linkType === 'none' ? 'item' : 'self';
  serializedJob.links = getLinksForDisplay(serializedJob, urlRoot, statusLinkRel, job.destination_url);
  if (!job.destination_url) {
    serializedJob.message = getMessageForDisplay(serializedJob, urlRoot);
  }

  const errors = [];
  const warnings = [];
  if (messages) {
    for (const message of messages) {
      if (message.level === JobMessageLevel.ERROR) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  if (errors.length > 0) {
    serializedJob.errors =  errors.map((e) => _.pick(e, ['url', 'message'])) as JobMessage[];
  }

  if (warnings.length > 0) {
    serializedJob.warnings = warnings.map((e) => _.pick(e, ['url', 'message'])) as JobMessage[];
  }

  return serializedJob;
}

/**
 * Helper function to pull back the provided job ID (optionally by username).
 *
 * @param tx - the transaction use to perform the queries
 * @param jobID - the id of job
 * @param username - the name of the user requesting the pause - null if the admin
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
 */
async function lookupJob(tx: Transaction, jobID: string, username: string): Promise<Job>  {
  const { job } = username ?
    await Job.byUsernameAndJobID(tx, username, jobID) :
    await Job.byJobID(tx, jobID);

  if (!job) {
    throw new NotFoundError(`Unable to find job ${jobID}`);
  }
  return job;
}

const failureStates = [JobStatus.FAILED, JobStatus.CANCELED];

/**
 * Returns whether the passed in status is a failure status
 *
 * @param status - The status to check whether it is considered a failure state
 *
 * @returns true if the status is a failure status and false otherwise
 */
export function isFailureStatus(status: JobStatus): boolean {
  return failureStates.includes(status);
}

/**
 * Set and save the final status of the job
 * and in the case of job failure or cancellation, its work items.
 * (Also clean up temporary work items.)
 * @param tx - the transaction to perform the updates with
 * @param job - the job to save and update
 * @param finalStatus - the job's final status
 * @param logger - the logger to use for logging errors/info
 * @param message - the job's final message
 * @throws {@link ConflictError} if the finalStatus is not a terminal state
 */
export async function completeJob(
  tx: Transaction,
  job: Job,
  finalStatus: JobStatus,
  logger: Logger,
  message = '',
): Promise<void> {
  try {
    if (!terminalStates.includes(finalStatus)) {
      throw new ConflictError(`Job cannot complete with status of ${finalStatus}.`);
    }
    const failed = isFailureStatus(finalStatus);
    job.updateStatus(finalStatus, message);
    await job.save(tx);
    if (failed) {
      const numUpdated = await updateWorkItemStatusesByJobId(
        tx, job.jobID, [WorkItemStatus.READY, WorkItemStatus.RUNNING, WorkItemStatus.QUEUED], WorkItemStatus.CANCELED,
      );
      logger.info(`Updated ${numUpdated} work items to ${WorkItemStatus.CANCELED} for completed job.`);
    }
    await deleteUserWorkForJob(tx, job.jobID);

    // Grab the operation from the first step which will be the full operation
    const initialStep = await getWorkflowStepByJobIdStepIndex(tx, job.jobID, 1);

    if (initialStep) {
      const operation = new DataOperation(JSON.parse(initialStep.operation));

      // Log information about the job
      const productMetric = getProductMetric(operation, job);

      const { originalSize, outputSize } = await getTotalWorkItemSizesForJobID(tx, job.jobID);
      const responseMetric = await getResponseMetric(operation, job, originalSize, outputSize);

      logger.info(`Job ${job.jobID} complete - product metric`, { productMetric: true, ...productMetric });
      logger.info(`Job ${job.jobID} complete - response metric`, { responseMetric: true, ...responseMetric });
    } else {
      logger.warn('Unable to pull back the initial operation for the job to log metrics.');
    }

  } catch (e) {
    logger.error(`Error encountered for job ${job.jobID} while attempting to set final status`);
    logger.error(e);
    throw e;
  }
}

/**
 * Cancel the job and save it to the database
 * @param jobID - the id of job (requestId in the db)
 * @param logger - the logger to use for logging errors/info
 * @param username - the name of the user requesting the cancel - null if the admin
 * @param _token - the access token for the user (not used)
 * @throws {@link ConflictError} if the job is already in a terminal state.
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
 */
export async function cancelAndSaveJob(
  jobID: string,
  logger: Logger,
  username?: string,
  _token?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = await lookupJob(tx, jobID, username);
    const message = username ? 'Canceled by user.' : 'Canceled by admin.';
    await completeJob(tx, job, JobStatus.CANCELED, logger, message);
  });
}

/**
 * Throws RequestValidationError if the JobID is not in the valid format for a jobID.
 * @param jobID - The jobID to validate
 */
export function validateJobId(jobID: string): void {
  if (!isUUID(jobID)) {
    throw new RequestValidationError(`Invalid format for Job ID '${jobID}'. Job ID must be a UUID.`);
  }
}

/**
 * Pause a job and then save it.
 *
 * @param jobID - the id of job (requestId in the db)
 * @param _logger - the logger to use for logging errors/info (unused, here to )
 * @param username - the name of the user requesting the pause - null if the admin
 * @param _token - the access token for the user (not used)
 * @throws {@link ConflictError} if the job is already in a terminal state.
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
 */
export async function pauseAndSaveJob(
  jobID: string,
  _logger?: Logger,
  username?: string,
  _token?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = await lookupJob(tx, jobID, username);
    job.pause();
    await job.save(tx);
    await setReadyCountToZero(tx, jobID);
  });
}

/**
 * Updates the user access token in the database and applies the appropriate job status function
 * to change the state of the job.
 *
 * @param jobID - the id of job (requestId in the db)
 * @param username - the name of the user requesting the resume - null if the admin
 * @param token - the access token for the user
 * @param jobStatusFn - a function that takes a job and calls the appropriate method on the job
 * in order to change the status field.
 * @throws {@link ConflictError} if the job is already in a terminal state.
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
*/
async function updateTokenAndChangeState(
  jobID: string, username: string, token: string, jobStatusFn: CallableFunction,
): Promise <void> {
  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  await db.transaction(async (tx) => {
    const job = await lookupJob(tx, jobID, username);
    if (username && token) {
      // update access token
      const workflowSteps = await getWorkflowStepsByJobId(tx, jobID);
      for (const workflowStep of workflowSteps) {
        const { operation } = workflowStep;
        const op = new DataOperation(JSON.parse(operation), encrypter, decrypter);
        op.accessToken = token;
        const serialOp = op.serialize(CURRENT_SCHEMA_VERSION);
        workflowStep.operation = serialOp;
        await workflowStep.save(tx);
      }
    }
    jobStatusFn(job);
    await job.save(tx);
    await recalculateReadyCount(tx, jobID);
  });
}

/**
 * Resume a paused job then save it.
 *
 * @param jobID - the id of job (requestId in the db)
 * @param _logger - the logger to use for logging errors/info
 * @param username - the name of the user requesting the resume - null if the admin
 * @param token - the access token for the user
 * @throws {@link ConflictError} if the job is already in a terminal state.
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
 */
export async function resumeAndSaveJob(
  jobID: string,
  _logger: Logger,
  username?: string,
  token?: string,

): Promise<void> {
  await updateTokenAndChangeState(jobID, username, token, ((job) => job.resume()));
}

/**
 * It takes a job ID, a logger, and optionally a username and access token, and then it updates the
 * job's workflow steps to use the new access token, and then it resumes the job
 * @param jobID - the job ID of the job you want to skip the preview for
 * @param _logger - Logger - this is a logger object that you can use to log messages to the
 * console.
 * @param username - The username of the user who is running the job.
 * @param token - The access token for the user.
 */
export async function skipPreviewAndSaveJob(
  jobID: string,
  _logger: Logger,
  username?: string,
  token?: string,

): Promise<void> {
  await updateTokenAndChangeState(jobID, username, token, ((job) => job.skipPreview()));
}

/**
 * Get a particular job only if it can be seen by the requesting user, (based on
 * whether they own the job or are an admin, and optionally if the job is shareable).
 * @param jobID - id of the job to query for
 * @param username - the username of the user requesting the job
 * @param isAdmin - whether to treat the user as an admin
 * @param accessToken - the user's access token
 * @param enableShareability - whether to check if the job can be shared with non-owners
 * @throws ForbiddenError, NotFoundError
 * @returns the requested job, if allowed
 */
export async function getJobIfAllowed(
  jobID: string,
  username: string,
  isAdmin: boolean,
  accessToken: string,
  enableShareability: boolean,
  includeLabels = true,
): Promise<Job> {
  validateJobId(jobID);
  const { job } = await Job.byJobID(db, jobID, false, includeLabels, false);
  if (!job) {
    throw new NotFoundError();
  }
  let canViewJob: boolean;
  const isAdminOrOwner = job.belongsToOrIsAdmin(username, isAdmin);
  if (isAdminOrOwner) {
    canViewJob = true;
  } else if (!enableShareability) {
    canViewJob = false;
  } else {
    canViewJob = await job.isShareable(accessToken);
  }
  if (canViewJob) {
    return job;
  } else {
    throw new ForbiddenError();
  }
}
