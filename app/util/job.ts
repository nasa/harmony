import { Logger } from 'winston';
import db, { Transaction } from './db';
import { Job, JobStatus, terminalStates } from '../models/job';
import env from './env';
import { getTotalWorkItemSizesForJobID, updateWorkItemStatusesByJobId } from '../models/work-item';
import { ConflictError, ForbiddenError, NotFoundError, RequestValidationError } from './errors';
import isUUID from './uuid';
import { WorkItemMeta, WorkItemStatus } from '../models/work-item-interface';
import { getWorkflowStepByJobIdStepIndex, getWorkflowStepsByJobId } from '../models/workflow-steps';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../models/data-operation';
import { createDecrypter, createEncrypter } from './crypto';
import { getProductMetric, getResponseMetric } from './metrics';

/**
 * Helper function to pull back the provided job ID (optionally by username).
 *
 * @param tx - the transaction use to perform the queries
 * @param jobID - the id of job (requestId in the db)
 * @param username - the name of the user requesting the pause - null if the admin
 * @throws {@link NotFoundError} if the job does not exist or the job does not
 * belong to the user.
 */
async function lookupJob(tx: Transaction, jobID: string, username: string): Promise<Job>  {
  let job;
  if (username) {
    ({ job } = await Job.byUsernameAndRequestId(tx, username, jobID));
  } else {
    ({ job } = await Job.byRequestId(tx, jobID));
  }

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
        tx, job.jobID, [WorkItemStatus.READY, WorkItemStatus.RUNNING], WorkItemStatus.CANCELED,
      );
      const itemMeta: WorkItemMeta = { workItemStatus: WorkItemStatus.CANCELED, workItemAmount: numUpdated, workItemEvent: 'statusUpdate' };
      logger.info(`Updated work items to ${WorkItemStatus.CANCELED} for completed job.`, itemMeta);
    }

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
  _logger: Logger,
  username?: string,
  _token?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = await lookupJob(tx, jobID, username);
    job.pause();
    await job.save(tx);
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
): Promise<Job> {
  validateJobId(jobID);
  const { job } = await Job.byRequestId(db, jobID, 0, 0);
  if (!job) {
    throw new NotFoundError();
  }
  if (await job.canViewJob(username, isAdmin, accessToken, enableShareability)) {
    return job;
  } else {
    throw new ForbiddenError();
  }
}

