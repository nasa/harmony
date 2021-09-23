import { Logger } from 'winston';
import db from './db';
import { Job, JobStatus } from '../models/job';
import { WorkItemStatus } from '../models/work-item';
import { NotFoundError } from './errors';
import { terminateWorkflows, checkIfTurboWorkflow } from './workflows';

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
        job.status = JobStatus.CANCELED;
        job.validateStatus();
        job.cancel(message);
        await job.save(tx);
        const updatedAt = new Date();
        await tx('work_items').where({ jobID: job.jobID }).update({ status: WorkItemStatus.CANCELED, updatedAt });
        // The following can be removed once Argo is removed
        const isArgoWorkflow = !await checkIfTurboWorkflow(tx, jobID, logger);
        if (isArgoWorkflow && shouldTerminateWorkflows) {
          await terminateWorkflows(job, logger);
        }
      } else {
        logger.warn(`Ignoring repeated cancel request for job ${jobID}`);
      }
    } else {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
  });
}
