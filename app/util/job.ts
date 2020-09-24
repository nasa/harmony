import { Logger } from 'winston';
import db from './db';
import { Job, JobQuery, JobStatus } from '../models/job';
import { NotFoundError } from './errors';
import { terminateWorkflows } from './workflows';

/**
 * Cancel the job and save it to the database
 * @param jobID the id of job (requestId in the db)
 * @param message the message to use for the canceled job
 * @param logger the logger to use for logging errors/info
 * @param shouldTerminateWorkflows true if the workflow(s) attached to the job should be terminated
 * @param username the name of the user requesting the cancel - null if the admin
 * @param shouldIgnoreRepeats flag to indicate that we should ignore repeat calls to cancel the
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
    const query: JobQuery = { requestId: jobID };
    if (username) {
      query.username = username;
    }
    const jobs = await Job.queryAll(tx, query);
    const job = jobs?.data[0];
    if (job) {
      if (job.status !== JobStatus.CANCELED || !shouldIgnoreRepeats) {
        job.status = JobStatus.CANCELED;
        job.validateStatus();
        job.cancel(message);
        await job.save(tx);
        if (shouldTerminateWorkflows) {
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
