import { Logger } from 'winston';
import db from './db';
import { Job, JobQuery } from '../models/job';
import { NotFoundError } from './errors';
import { terminateWorkflows } from './workflows';

/**
 *
 * @param jobID
 * @param message
 * @param logger
 * @param shouldTerminateWorkflows
 * @param username
 */
export default async function cancelAndSaveJob(jobID: string, message: string, logger: Logger,
  shouldTerminateWorkflows: boolean, username?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const query: JobQuery = { requestId: jobID };
    if (username) {
      query.username = username;
    }
    const jobs = await Job.queryAll(tx, query);
    const job = jobs?.data[0];
    if (job) {
      job.cancel(message);
      await job.save(tx);
      if (shouldTerminateWorkflows) {
        await terminateWorkflows(job, logger);
      }
    } else {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
  });
}
