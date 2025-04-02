import { Job, JobStatus } from '../../../harmony/app/models/job';
import UserWork, {
  recalculateCounts, setReadyAndRunningCountToZero,
} from '../../../harmony/app/models/user-work';
import { Context } from '../util/context';
import env from '../util/env';
import { CronJob } from './cronjob';

/**
 *
 * @param ctx - The Cron job context
 */
export async function updateUserWork(ctx: Context): Promise<void> {
  const { logger, db } = ctx;
  await db.transaction(async (tx) => {
    // find jobs in the user-work table that haven't been updated in a while
    let query = tx(UserWork.table)
      .distinct('job_id')
      .where(function () {
        void this.where('ready_count', '>', 0).orWhere('running_count', '>', 0);
      });
    if (env.databaseType === 'sqlite') {
      const timeStamp = Date.now() - env.userWorkExpirationMinutes * 60 * 1000;
      query = query.andWhere(tx.raw(`last_worked <= ${timeStamp}`));
    } else {
      query = query.andWhere('last_worked', '<=', tx.raw(`now() - interval '${env.userWorkExpirationMinutes} minutes'`));
    }

    const results = await query;
    const jobIDs = results.map((r) => r.job_id);

    // reset the counts for the jobs
    for (const jobID of jobIDs) {
      const { job } = await Job.byJobID(tx, jobID);
      if ([JobStatus.PAUSED, JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.COMPLETE_WITH_ERRORS, JobStatus.FAILED].includes(job.status)) {
        logger.warn(`Resetting user_work counts to 0 for job ${jobID} with status ${job.status}`);
        await setReadyAndRunningCountToZero(tx, jobID);
      } else {
        logger.warn(`Recalculating user_work counts for job ${jobID} with status ${job.status}`);
        await recalculateCounts(tx, jobID);
      }
    }
  });
}

/**
 * Cron job to clean up the user-work table to avoid excess pods staying active
 */
export class UserWorkUpdater extends CronJob {

  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.debug('Running');
    try {
      await updateUserWork(ctx);
    } catch (e) {
      logger.error('User work udpater failed to update user-work table');
      logger.error(e);
    }
  }
}