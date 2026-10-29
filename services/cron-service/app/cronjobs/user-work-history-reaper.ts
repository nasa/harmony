import { subDays } from 'date-fns';

import { CronJob } from './cronjob';
import { terminalStates } from '../../../harmony/app/models/job';
import {
  deleteUserWorkHistoryByIds, getExpiredUserWorkHistoryIds,
} from '../../../harmony/app/models/user-work-history';
import { Context } from '../util/context';
import env from '../util/env';

/**
 * Deletes user_work_history rows that were last written before the cutoff, for jobs that are in a
 * terminal state (or no longer exist). Rows are deleted in batches of
 * USER_WORK_HISTORY_REAPER_BATCH_SIZE, each in its own short statement rather than one
 * transaction, so no locks are held for long. Nothing on the scheduling or work item update paths
 * reads or writes rows this old, so deleting them doesn't contend with either. The rows remain in
 * Iceberg, since the analytics cron never deletes rows there.
 *
 * @param ctx - The Cron job context
 * @param retiredBefore - Rows last written before this time are deleted
 * @returns the number of rows deleted
 */
export async function deleteExpiredUserWorkHistory(ctx: Context, retiredBefore: Date): Promise<number> {
  const { logger, db } = ctx;
  const batchSize = env.userWorkHistoryReaperBatchSize;
  let startingId = 0;
  let totalDeleted = 0;
  let done = false;

  while (!done) {
    const ids = await getExpiredUserWorkHistoryIds(db, retiredBefore, terminalStates, startingId, batchSize);
    if (ids.length > 0) {
      totalDeleted += await deleteUserWorkHistoryByIds(db, ids);
      startingId = ids[ids.length - 1];
    }
    if (ids.length < batchSize) {
      done = true;
    }
  }
  logger.info(`User work history reaper deleted ${totalDeleted} rows retired before ${retiredBefore.toISOString()}`);
  return totalDeleted;
}

/**
 * Cron job that deletes old rows from the user_work_history table so it doesn't grow without bound
 */
export class UserWorkHistoryReaper extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started user work history reaper cron job');
    try {
      const retiredBefore = subDays(new Date(), env.userWorkHistoryRetentionDays);
      await deleteExpiredUserWorkHistory(ctx, retiredBefore);
      logger.info('Completed user work history reaper cron job');
    } catch (e) {
      logger.error('User work history reaper failed to delete expired rows');
      logger.error(e);
    }
  }
}
