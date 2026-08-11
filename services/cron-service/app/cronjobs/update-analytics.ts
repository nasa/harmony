import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import snakeCaseKeys from 'snakecase-keys';

import { CronJob } from './cronjob';
import { Context } from '../util/context';
import { initDbConnection } from '../util/db/iceberg-connection';


/**
 * Read a batch of rows from Postgres with an `updatedAt` after a given time.
 *
 * @param ctx - The Cron job context
 * @param table - The name of the table to read
 * @param latestUpdatedAt - Most recent updatedAt written to Iceberg
 * @param batchSize - Maximum number of rows to process
 * @returns A Promise containing an array of maps representing the rows retrieved from Postgres
 */
async function getPostgresRows(ctx: Context, table: string, latestUpdatedAt: string, batchSize: number = 1000): Promise<Array<Map<string, any>>> {
  const { logger, db } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = new Array<Map<string, any>>();

  try {
    const res = await db(table)
      .select()
      .whereRaw('"updatedAt" > (?::timestamptz - INTERVAL \'1 minutes\')', [latestUpdatedAt])
      .orderBy('updatedAt', 'asc')
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
 *  Get the latest updateTime for the given Iceberg table
 *
 * @param ctx - The Cron job context
 * @param duckDbConn - A connection to the Iceberg database
 * @param table - The name of the table to process
 * @returns A Promise containing the latest updateTime for the Iceberg table
 */
async function getLatestIcebergTableUpdateTime(ctx: Context, duckDbConn: DuckDBConnection, table: String): Promise<Date> {
  const { logger } = ctx;
  try {
    const reader = await duckDbConn.runAndReadAll(`
			SELECT max(updated_at) FROM catalog.iceberg.${table};
		`);
    const rows = reader.getRowObjectsJson();
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

  try {
    const duckDbInstance = await DuckDBInstance.fromCache(':memory:');
    const duckDbConn = await duckDbInstance.connect();
    await initDbConnection(duckDbConn);

    for (const table of tables) {
      const latestUpdateTime = await getLatestIcebergTableUpdateTime(ctx, duckDbConn, table);
      logger.debug(`=============> Table ${table} latest update time is ${latestUpdateTime.toISOString()}`);
      const rows = await getPostgresRows(ctx, table, latestUpdateTime.toISOString());
      if (rows && rows.length > 0) {
        const tempDir = tmpdir();

        const uniqueFilename = `temp-data-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.json`;
        const tempFilePath = join(tempDir, uniqueFilename);

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
 	         			     INSERT BY NAME;`;
          await duckDbConn.run(query);
          logger.debug(`Wrote ${rows.length} rows to ${table}`);

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
  } catch (err) {
    logger.error(err);
  }
}

/**
 * Analytics updater class for cron service
 */
export class AnalyticsCron extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started analytics cron job');
    try {
      process.env.AWS_ACCOUNT_ID = '000000000000';
      await updateAnalytics(ctx);
      logger.info('Completed analytics cron job');
    } catch (e) {
      logger.error('Failed to update analytics');
      logger.error(e);
    }
  }
}
