import { Job, JobStatus } from '../../../harmony/app/models/job';
import UserWork, {
  recalculateCounts, setReadyAndRunningCountToZero,
} from '../../../harmony/app/models/user-work';
import { Context } from '../util/context';
import env from '../util/env';
import { CronJob } from './cronjob';

/**
 * Converts a time interval string to a Unix timestamp in milliseconds
 * representing the current time plus or minus the specified interval.
 *
 * @param intervalString - A string like '-1 HOUR', '+10 MINUTE', '-15 SECONDS'
 * @returns Unix timestamp in milliseconds
 * @throws Error if the interval string format is invalid
 */
export function getTimestampFromInterval(intervalString: string): number {
  // Regular expression to match the format: (+/-)NUMBER UNIT
  const regex = /^([+-])(\d+)\s+(SECOND|SECONDS|MINUTE|MINUTES|HOUR|HOURS|DAY|DAYS)$/i;
  const match = intervalString.trim().match(regex);

  if (!match) {
    throw new Error(
      `Invalid interval [${intervalString}] format. Must be in format like "+1 HOUR", "-10 MINUTES", "+30 SECONDS"`,
    );
  }

  const [, sign, valueStr, unit] = match;
  const value = parseInt(valueStr, 10);
  const isNegative = sign === '-';

  // Calculate milliseconds based on the unit
  let milliseconds = 0;
  const unitLower = unit.toLowerCase();

  if (unitLower === 'second' || unitLower === 'seconds') {
    milliseconds = value * 1000;
  } else if (unitLower === 'minute' || unitLower === 'minutes') {
    milliseconds = value * 60 * 1000;
  } else if (unitLower === 'hour' || unitLower === 'hours') {
    milliseconds = value * 60 * 60 * 1000;
  } else if (unitLower === 'day' || unitLower === 'days') {
    milliseconds = value * 24 * 60 * 60 * 1000;
  }

  // Get current timestamp
  const currentTimestamp = Date.now();

  // Apply the interval
  return isNegative ? currentTimestamp - milliseconds : currentTimestamp + milliseconds;
}

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
      const timeStamp = getTimestampFromInterval(`-${env.userWorkUpdateAge}`);
      query = query.andWhere(tx.raw(`last_worked <= ${timeStamp}`));
    } else {
      query = query.andWhere('last_worked', '<=', tx.raw(`now() - interval '${env.userWorkUpdateAge}'`));
    }

    const results = await query;
    const jobIDs = results.map((r) => r.job_id);

    // reset the counts for the jobs
    for (const jobID of jobIDs) {
      logger.info(`Resetting user-work counts for job ${jobID}`);
      const { job } = await Job.byJobID(tx, jobID);
      if (job.status === JobStatus.PAUSED) {
        await setReadyAndRunningCountToZero(tx, jobID);
      } else {
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