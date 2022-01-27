import { Logger } from 'winston';
import { promises as fs } from 'fs';
import db, { Transaction } from './db';
import { Job, JobStatus, terminalStates } from '../models/job';
import env from './env';
import { updateWorkItemStatusesByJobId, WorkItemStatus } from '../models/work-item';
import { ConflictError, NotFoundError, RequestValidationError } from './errors';
import isUUID from './uuid';

/**
 * Cleans up the temporary work items for the provided jobID
 * @param jobID - the jobID for which to remove temporary work items
 * @param logger - the logger associated with the request
 */
async function cleanupWorkItemsForJobID(jobID: string, logger: Logger): Promise<void> {
  try {
    await fs.rmdir(`${env.hostVolumePath}/${jobID}/`, { recursive: true });
  } catch (e) {
    logger.warn(`Unable to clean up temporary files for ${jobID}`);
    logger.warn(e);
  }
}

/**
   * Set and save the final status of the turbo job
   * and in the case of job failure or cancellation, its work items.
   * (Also clean up temporary work items.)
   * @param tx - the transaction to perform the updates with
   * @param job - the job to save and update
   * @param finalStatus - the job's final status
   * @param logger - the logger to use for logging errors/info
   * @param message - the job's final message
   * @throws {@link ConflictError} if the finalStatus is not within terminalStates
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
 * @param message - the message to use for the canceled job
 * @param logger - the logger to use for logging errors/info
 * @param shouldTerminateWorkflows - true if the workflow(s) for the job should be terminated
 * @param username - the name of the user requesting the cancel - null if the admin
 * @param shouldIgnoreRepeats - flag to indicate that we should ignore repeat calls to cancel the
 * same job - needed for the workflow termination listener (default false)
 */
export default async function cancelAndSaveJob(
  jobID: string,
  message: string,
  logger: Logger,
  shouldTerminateWorkflows: boolean,
  username: string,
  shouldIgnoreRepeats = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    let job;
    if (username) {
      ({ job } = await Job.byUsernameAndRequestId(tx, username, jobID));
    } else {
      ({ job } = await Job.byRequestId(tx, jobID));
    }

    if (job) {
      if (job.status !== JobStatus.CANCELED || !shouldIgnoreRepeats) {
        await completeJob(tx, job, JobStatus.CANCELED, logger, message);
      } else {
        logger.warn(`Ignoring repeated cancel request for job ${jobID}`);
      }
    } else {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
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
