import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { objectToSnake } from 'ts-case-convert';

import { Job } from '../../../harmony/app/models/job';
import { CronJob } from './cronjob';
import { Context } from '../util/context';
import { releaseDuckDbConnection } from '../util/db/iceberg-connection';


/**
*
*/
async function getJobsRows(ctx: Context, latestUpdatedAt: string): Promise<Array<Map<string, any>>> {
  const { logger, db } = ctx; 
  const result = new Array<Map<string, any>>();
  try {
	  await db.transaction(async (tx) => {
	    // Use .whereRaw() and parameter binding (?)
	    // Also using the standard Postgres INTERVAL syntax
	    let query = tx(Job.table)
	      .select()
	      .whereRaw(`"updatedAt" > (?::timestamptz - INTERVAL '15 minutes') ORDER BY "updatedAt" ASC LIMIT 1000`, [latestUpdatedAt]);
	      
	    const res = await query;
	    logger.info("ROWS===============");
	    
	    for (let row of res) {
	      row = objectToSnake(row);
	      logger.info(row);
	      result.push(row);
	    } 
	  });
  } catch (err) {
  	logger.error(err);
  }
  return result;
}



/**
 * Main function that gets called each time the cron kicks off. It updates the
 * Iceberg analytics tables to capture new rows from the RDS tables.
 *
 * @param ctx - The Cron job context
 * @throws error if there is an issue updating the stats
 * @returns a Promise that resolves when the request completes
 */
async function updateAnalytics(ctx: Context): Promise<void> {
  const { logger } = ctx;
  const tables = ['jobs', 'job_links', 'work_items', 'workflow_steps'];
  for (const table of tables) {
    const latestUpdateTime = await getLatestIcebergTableUpdateTime(ctx, table);
    logger.info(`=============> Table ${table} latest update time is ${latestUpdateTime}`);
    if (table === 'jobs') {
      await getJobsRows(ctx, latestUpdateTime.toISOString());
    }

  }
}

/**
 *
 */
async function getLatestIcebergTableUpdateTime(ctx: Context, table: String): Promise<Date> {
  const { logger, duckDbConn } = ctx;
  try {
    const reader = await duckDbConn.runAndReadAll(`
			SELECT max(updated_at) FROM catalog.iceberg.${table};
		`);
    const rows = reader.getRowObjectsJson();
    logger.info(rows);
    if (rows) {
      const updatedAt = rows[0]['max(updated_at)'].toString();

      return new Date(updatedAt);

    }

    return new Date();

  } catch (error) {
    logger.error(error);
  }
}

/**
 *
 */
async function initDbConnection(conn: DuckDBConnection) {
  const sql = `
	INSTALL aws;
    INSTALL httpfs;
    INSTALL iceberg;
    LOAD aws;
    LOAD httpfs;

	CREATE SECRET ministack_s3 (
      TYPE s3,
      KEY_ID 'ministack_fake_key',
      SECRET 'ministack_fake_secret',
      REGION 'us-east-1',
      ENDPOINT 'localhost:4566', -- Adjust to your MiniStack container port if different
      USE_SSL false
    );
	ATTACH 'arn:aws:s3tables:us-west-2:000000000000:bucket/icebeg-tables'
    AS catalog (
      TYPE iceberg,
      ENDPOINT 'http://localhost:4566/iceberg',
      AUTHORIZATION_TYPE 'none'
    );`;
  await conn.run(sql);
}



/**
 * Analytics updater class for cron service
 */
export class AnalyticsCron extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started analytics cron job');
    try {
      // ctx.duckDbConn = await acquireDuckDbConnection();
      process.env.AWS_ACCOUNT_ID = '000000000000';
      const instance = await DuckDBInstance.fromCache(':memory:');
      ctx.duckDbConn = await instance.connect();
      await initDbConnection(ctx.duckDbConn);
      await updateAnalytics(ctx);
      logger.info('Completed analytics cron job');
    } catch (e) {
      logger.error('Failed to update analytics');
      logger.error(e);
    } finally {
      await releaseDuckDbConnection(ctx.duckDbConn);
    }
  }
}
