import { CronJob } from './cronjob';
import { pruneWorkItemStats, upsertWorkItemStats } from '../../../harmony/app/models/work-items-stats';
import { Context } from '../util/context';
import env from '../util/env';

/**
 * Main function that gets called each time the cron kicks off. It updates the dashboard stats
 * tables (work_items_stats and the others populated alongside it) to capture per minute work item
 * and job completion stats, then deletes expired rows from them.
 *
 * @param ctx - The Cron job context
 * @throws error if there is an issue updating the stats
 * @returns Resolves when the request completes
 */
async function updateWorkItemStats(ctx: Context): Promise<void> {
  const { logger, db } = ctx;
  await db.transaction(async (tx) => {
    const numRowsInserted = await upsertWorkItemStats(tx);
    logger.info(`Work items stats updater inserted or updated ${numRowsInserted} rows`);
  });

  // Outside of the transaction above, so each delete commits on its own and no locks are held for
  // longer than a single delete
  const deleted = await pruneWorkItemStats(
    db, env.workItemsStatsMinuteRetentionDays, env.workItemsStatsHourlyRetentionDays,
    env.workItemsStatsPruneHoursPerRun);
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  if (total > 0) {
    logger.info(`Work items stats updater deleted ${total} expired rows`, { deleted });
  }
}

/**
 * Work items stats updater class for cron service
 */
export class WorkItemsStatsCron extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started work items stats cron job');
    try {
      await updateWorkItemStats(ctx);
      logger.info('Completed work items stats cron job');
    } catch (e) {
      logger.error('Failed to update work items stats');
      logger.error(e);
    }
  }
}
