import { CronJob } from './cronjob';
import { upsertWorkItemStats } from '../../../harmony/app/models/work-items-stats';
import { Context } from '../util/context';

/**
 * Main function that gets called each time the cron kicks off. It updates the
 * work_items_stats table to capture per minute work item completion counts.
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
