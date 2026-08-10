import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import * as duckdb from '@duckdb/node-api';
import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { tableFromJSON } from "apache-arrow";
import snakeCaseKeys  from "snakecase-keys";

import { CronJob } from './cronjob';
import { Context } from '../util/context';
import { releaseDuckDbConnection } from '../util/db/iceberg-connection';


/**
* Read a batch of rows from Postgres with an `updatedAt` after a given time.
*
*/
async function getPostgresRows(ctx: Context, table: string, latestUpdatedAt: string, batchSize: number = 1000): Promise<Array<Map<string, any>>> {
const { logger, db } = ctx; 
const result = new Array<Map<string, any>>();
  
try {
  const res = await db(table)
    .select()
    .whereRaw(`"updatedAt" > (?::timestamptz - INTERVAL '1 minutes')`, [latestUpdatedAt])
    .orderBy("updatedAt", "asc")
    .limit(batchSize);
      
  for (let row of res) {
    row = snakeCaseKeys(row);
    result.push(row);
  } 
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
  const { logger, duckDbConn } = ctx;
  const tables = ['jobs', 'job_links', 'work_items', 'workflow_steps'];
  for (const table of tables) {
    const latestUpdateTime = await getLatestIcebergTableUpdateTime(ctx, table);
    logger.debug(`=============> Table ${table} latest update time is ${latestUpdateTime.toISOString()}`);
    const rows = await getPostgresRows(ctx, table, latestUpdateTime.toISOString());
    logger.debug('ROWS==========');
    logger.debug(rows);
    if (rows && rows.length > 0) {
	     const tempDir = tmpdir();
	    
	     const uniqueFilename = `temp-data-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.json`;
	     const tempFilePath = join(tempDir, uniqueFilename);
	     logger.debug(`TEMP_FILE_PATH = ${tempFilePath}`);
	     try {
	      
	         const jsonString = JSON.stringify(rows, null, 2);
	         writeFileSync(tempFilePath, jsonString, 'utf8');
	         const query = `MERGE INTO catalog.iceberg.${table} AS target
	         			   USING (
	         			     SELECT * FROM read_json_auto('${tempFilePath}')
	         			   ) as upserts
	         			   ON target.id = upserts.id
	         			   WHEN MATCHED THEN
	         			     UPDATE SET *
	         			   WHEN NOT MATCHED THEN
	         			     INSERT BY NAME;`
	         await duckDbConn.run(query);
	         logger.debug(`Wrote new rows to ${table}`);
     
     	} catch (err) {
     	  logger.error(err); 
     	} finally {
     	  // Ensure temporary file is cleaned up even if duckDbConn throws
     	  try {
     	    unlinkSync(tempFilePath);
     	  } catch (e) {
     	    logger.warn(`Failed to cleanup temp file: ${tempFilePath}`);
     	  }
     	}
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
    // logger.info(rows);
    if (rows && rows[0] && rows[0]['max(updated_at)']) {
      const updatedAt = rows[0]['max(updated_at)'].toString();
      return new Date(updatedAt);

    }
	
	const oldDate = new Date();
	oldDate.setFullYear(1, 1, 1);
    return oldDate;

  } catch (error) {
    logger.error(error);
  }
}

/**
 *
 */
// async function initDbConnection(conn: DuckDBConnection) {
  // const sql = `
	// INSTALL aws;
    // INSTALL httpfs;
    // INSTALL iceberg;
    // LOAD aws;
    // LOAD httpfs;
    // SET TimeZone = 'UTC';
// 
	// CREATE SECRET ministack_s3 (
      // TYPE s3,
      // KEY_ID 'ministack_fake_key',
      // SECRET 'ministack_fake_secret',
      // REGION 'us-east-1',
      // ENDPOINT 'localhost:4566', -- Adjust to your MiniStack container port if different
      // USE_SSL false
    // );
	// ATTACH 'arn:aws:s3tables:us-west-2:000000000000:bucket/icebeg-tables'
    // AS catalog (
      // TYPE iceberg,
      // ENDPOINT 'http://localhost:4566/iceberg',
      // AUTHORIZATION_TYPE 'none'
    // );`;
  // await conn.run(sql);
// }



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
      // const instance = await DuckDBInstance.fromCache(':memory:');
      // ctx.duckDbConn = await instance.connect();
      // await initDbConnection(ctx.duckDbConn);
      await updateAnalytics(ctx);
      logger.info('Completed analytics cron job');
    } catch (e) {
      logger.error('Failed to update analytics');
      logger.error(e);
    } finally {
      // await releaseDuckDbConnection(ctx.duckDbConn);
    }
  }
}
