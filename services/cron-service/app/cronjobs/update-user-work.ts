import { Knex } from 'knex';

import { CronJob } from './cronjob';
import { Job, JobStatus } from '../../../harmony/app/models/job';
import UserWork, {
  deleteUserWorkForJob, recalculateCounts,
} from '../../../harmony/app/models/user-work';
import { Context } from '../util/context';
import env from '../util/env';

// When (epoch ms) each job's user_work counts were last recalculated by this process. A job that
// hasn't been worked in a while is usually just waiting its turn, so recalculating it again every
// run only adds load (and job locks that block the work item updaters) without changing anything.
const recentlyRecalculated = new Map<string, number>();

/**
 * Forgets which jobs were recently recalculated - only meant for tests
 */
export function resetRecentlyRecalculatedJobs(): void {
  recentlyRecalculated.clear();
}

/**
 * Adds the filter for user_work rows that haven't been worked within USER_WORK_EXPIRATION_MINUTES
 *
 * @param db - The database connection or transaction
 * @param query - The user_work query to filter
 * @returns the filtered query
 */
function whereNotRecentlyWorked(db: Knex, query: Knex.QueryBuilder): Knex.QueryBuilder {
  if (env.databaseType === 'sqlite') {
    const timeStamp = Date.now() - env.userWorkExpirationMinutes * 60 * 1000;
    return query.andWhere(db.raw(`last_worked <= ${timeStamp}`));
  }
  return query.andWhere('last_worked', '<=', db.raw(`now() - interval '${env.userWorkExpirationMinutes} minutes'`));
}

/**
 * Recalculates (or removes) the user_work rows for jobs that haven't been worked in a while,
 * skipping jobs this process recalculated within the last USER_WORK_UPDATER_RECHECK_MINUTES. Jobs
 * are processed USER_WORK_UPDATER_BATCH_SIZE at a time, and each job in its own transaction, so a
 * job's lock is only held while that job is processed.
 *
 * @param ctx - The Cron job context
 */
export async function updateUserWork(ctx: Context): Promise<void> {
  const startTime = new Date().getTime();
  const { logger, db } = ctx;

  const recheckCutoff = startTime - env.userWorkUpdaterRecheckMinutes * 60 * 1000;
  for (const [jobID, recalculatedAt] of recentlyRecalculated) {
    if (recalculatedAt <= recheckCutoff) {
      recentlyRecalculated.delete(jobID);
    }
  }

  // find jobs in the user_work table that haven't been updated in a while
  const results = await whereNotRecentlyWorked(db, db(UserWork.table).distinct('job_id'));
  const candidateIDs: string[] = results
    .map((r) => r.job_id)
    .filter((jobID) => !recentlyRecalculated.has(jobID));
  const skippedCount = results.length - candidateIDs.length;

  let updatedCount = 0;
  for (let i = 0; i < candidateIDs.length; i += env.userWorkUpdaterBatchSize) {
    const batch = candidateIDs.slice(i, i + env.userWorkUpdaterBatchSize);
    // re-check the batch, since jobs may have been worked while earlier batches were processed
    const staleRows = await whereNotRecentlyWorked(
      db, db(UserWork.table).distinct('job_id').whereIn('job_id', batch),
    );
    const jobIDs: string[] = staleRows.map((r) => r.job_id);

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
          recentlyRecalculated.set(jobID, Date.now());
        }
      });
    }
    updatedCount += jobIDs.length;
  }
  const durationMs = new Date().getTime() - startTime;
  logger.info(`Finished updating user work counts for ${updatedCount} jobs`, { durationMs, skippedCount });
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
