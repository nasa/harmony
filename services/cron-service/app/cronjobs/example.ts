import { Context } from '../util/context';
import { CronJob } from './cronjob';

/**
 * Example class for cron service
 */
export class Example extends CronJob {
  static async run(ctx: Context): Promise<void> {
    ctx.logger.debug(`Current time: ${JSON.stringify(new Date(Date.now()))}`);
  }
}
