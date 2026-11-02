import { CronJob } from './cronjob';
import { Job, JobStatus } from '../../../harmony/app/models/job';
import UserWork, {
  deleteUserWorkForJob, recalculateCounts,
} from '../../../harmony/app/models/user-work';
import { Context } from '../util/context';
import env from '../util/env';

/**
 *
 * @param ctx - The Cron job context
 */
export async function updateUserWork(ctx: Context): Promise<void> {
  const startTime = new Date().getTime();
  const { logger, db } = ctx;
  const jobIDs: string[] = await db.transaction(async (tx) => {
    // find jobs in the user_work table that haven't been updated in a while
    let query = tx(UserWork.table).distinct('job_id');
    if (env.databaseType === 'sqlite') {
      const timeStamp = Date.now() - env.userWorkExpirationMinutes * 60 * 1000;
      query = query.andWhere(tx.raw(`last_worked <= ${timeStamp}`));
    } else {
      query = query.andWhere('last_worked', '<=', tx.raw(`now() - interval '${env.userWorkExpirationMinutes} minutes'`));
    }

    const results = await query;
    return results.map((r) => r.job_id);
  });

  // reset the counts for the jobs, each in its own transaction so each job's lock is only held
  // while that job is processed, rather than until every job has been
  for (const jobID of jobIDs) {
    await db.transaction(async (tx) => {
      // Lock the job first, as pause/resume and the work item updaters do. Otherwise a resume
      // could recount this job's rows while they're being deleted here, leaving a running job
      // with no user_work rows (and its totals not restored from user_work_history).
      const { job } = await Job.byJobID(tx, jobID, false, false, true);
      if ([JobStatus.PAUSED, JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.COMPLETE_WITH_ERRORS, JobStatus.FAILED].includes(job.status)) {
        logger.warn(`Removing user_work rows for job ${jobID} with status ${job.status}`);
        await deleteUserWorkForJob(tx, jobID);
      } else {
        logger.warn(`Recalculating user_work counts for job ${jobID} with status ${job.status}`);
        await recalculateCounts(tx, jobID, env.userWorkDurationSeedLookbackDays);
      }
    });
  }
  const durationMs = new Date().getTime() - startTime;
  logger.info(`Finished updating user work counts for ${jobIDs.length} jobs`, { durationMs });
}

/**
 * Cron job to clean up the user_work table to ensure work is scheduled while also
 * preventing excess pods from staying active
 */
export class UserWorkUpdater extends CronJob {

  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started user work updater cron job');
    try {
      await updateUserWork(ctx);
    } catch (e) {
      logger.error('User work updater failed to update user_work table');
      logger.error(e);
    }
  }
}
