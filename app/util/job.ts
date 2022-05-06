import { Logger } from 'winston';
import { promises as fs } from 'fs';
import db, { Transaction } from './db';
import { Job, JobEvent, JobStatus, terminalStates, validateTransition } from '../models/job';
import env from './env';
import { getScrollIdForJob, updateWorkItemStatusesByJobId } from '../models/work-item';
import { ConflictError, NotFoundError, RequestValidationError } from './errors';
import isUUID from './uuid';
import { clearScrollSession } from './cmr';
import { WorkItemStatus } from '../models/work-item-interface';
import { getWorkflowStepsByJobId } from '../models/workflow-steps';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../models/data-operation';
import { createDecrypter, createEncrypter } from './crypto';

/**
 * Cleans up the temporary work items for the provided jobID
 * @param jobID - the jobID for which to remove temporary work items
 * @param logger - the logger associated with the request
 */
async function cleanupWorkItemsForJobID(jobID: string, logger: Logger): Promise<void> {
  try {
    await fs.rm(`${env.hostVolumePath}/${jobID}/`, { recursive: true });
  } catch (e) {
    logger.warn(`Unable to clean up temporary files for ${jobID}`);
    logger.warn(e);
  }
}

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
    job.updateStatus(finalStatus, message);
    await job.save(tx);
    if ([JobStatus.FAILED, JobStatus.CANCELED].includes(finalStatus)) {
      await updateWorkItemStatusesByJobId(
        tx, job.jobID, [WorkItemStatus.READY, WorkItemStatus.RUNNING], WorkItemStatus.CANCELED,
      );
    }
  } catch (e) {
    logger.error(`Error encountered for job ${job.jobID} while attempting to set final status`);
    logger.error(e);
    throw e;
  } finally {
    await cleanupWorkItemsForJobID(job.jobID, logger);
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
    // attempt to clear the CMR scroll session if this job had one
    const scrollId = await getScrollIdForJob(tx, job.jobID);
    await clearScrollSession(scrollId);
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
    job.resume();
    await job.save(tx);
  });
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
    job.skipPreview();
    await job.save(tx);
  });
}

/**
 * Return a set of JobEvents representing the actions that are currently available
 * to a user with respect to the job in question.
 * Note that this returns only actions that users can take (e.g. JobEvent.FAIL will not be returned).
 * @param job - the job to return valid actions (JobEvents) for
 * @returns a set of JobEvent
 */
export function getUserEventsForJob(job: Job): Set<JobEvent> {
  const allActions: [JobEvent, JobStatus][] = [
    [JobEvent.CANCEL, JobStatus.CANCELED],
    [JobEvent.PAUSE, JobStatus.PAUSED], 
    [JobEvent.RESUME, JobStatus.RUNNING], 
    [JobEvent.SKIP_PREVIEW, JobStatus.RUNNING],
  ];
  const validEvents = new Set<JobEvent>();
  for (const [event, newStatus] of allActions) {
    try {
      validateTransition(job.status, newStatus, event);
      validEvents.add(event);
    } catch {}
  }
  return validEvents;
}