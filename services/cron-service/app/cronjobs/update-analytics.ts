import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import snakeCaseKeys from 'snakecase-keys';

import { CronJob } from './cronjob';
import { Context } from '../util/context';
import { initDbConnection } from '../util/db/iceberg-connection';
import env from '../util/env';
import { tableRowTransforms } from '../util/iceberg-row-transforms';


export const ALL_TABLES = ['batch_items', 'batches', 'job_links', 'job_messages', 'jobs',
  'jobs_raw_labels', 'raw_labels', 'service_deployments', 'users_labels', 'work_items',
  'workflow_steps'];

/**
 * A cursor identifying the last row seen from a previous batch, used to page
 * through results in `updatedAt`/`id` order without skipping or repeating rows.
 */
interface RowCursor {
  updatedAt: Date;
  id: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>;

/**
 * Read a single batch of rows from Postgres with an `updatedAt` at or after a given
 * time (with a safety buffer to guard against clock skew/late-committing transactions
 * near the boundary). Pass the cursor returned from a previous call to page forward
 * through subsequent batches in `updatedAt`, `id` order.
 *
 * @param ctx - The Cron job context
 * @param table - The name of the table to read
 * @param latestUpdateTime- Most recent updatedAt written to Iceberg
 * @param cursor - The last row seen from a previous batch, or null to start from the beginning
 * @param batchSize - Maximum number of rows to process
 * @returns A Promise containing an array of maps representing the rows retrieved from Postgres
 */
async function getPostgresRows(ctx: Context, table: string, latestUpdateTime: string,
  cursor: RowCursor | null, batchSize: number = 1000): Promise<Array<PgRow>> {
  const { logger, db } = ctx;
  const result = new Array<PgRow>();

  try {
    const query = db(table)
      .select()
      .orderBy('updatedAt', 'asc')
      .orderBy('id', 'asc')
      .limit(batchSize);

    if (cursor) {
      query.whereRaw('("updatedAt", id) > (?::timestamptz, ?)', [cursor.updatedAt, cursor.id]);
    } else {
      query.whereRaw('"updatedAt" >= (?::timestamptz - INTERVAL \'1 minutes\')',
        [latestUpdateTime]);
    }

    const res = await query;

    for (let row of res) {
      row = snakeCaseKeys(row);
      if (tableRowTransforms[table]) {
        tableRowTransforms[table](row);
      }
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
async function getLatestIcebergTableUpdateTime(ctx: Context, duckDbConn: DuckDBConnection,
  table: String): Promise<Date> {
  const { logger } = ctx;
  const oldDate = new Date();
  oldDate.setFullYear(1, 1, 1);

  try {
    const reader = await duckDbConn.runAndReadAll(`
			SELECT max(updated_at) FROM catalog.iceberg.${table};
		`);
    const rows = reader.getRowObjectsJson();
    if (rows && rows[0] && rows[0]['max(updated_at)']) {
      const updatedAt = rows[0]['max(updated_at)'].toString();
      return new Date(updatedAt);
    }

    return oldDate;

  } catch (error) {
    logger.error(error);
    return oldDate;
  }
}

/**
 * Merge a batch of Postgres rows into the corresponding Iceberg table.
 *
 * @param ctx - The Cron job context
 * @param duckDbConn - A connection to the Iceberg database
 * @param table - The name of the table to write to
 * @param rows - The rows to merge in
 * @returns a Promise that resolves when the merge completes
 */
async function mergeRowsIntoIceberg(ctx: Context, duckDbConn: DuckDBConnection, table: string,
  rows: Array<PgRow>): Promise<void> {
  const startTime = new Date().getTime();
  const { logger } = ctx;
  const tempDir = tmpdir();
  const uniqueFilename = `temp-data-${Date.now()}-${Math.random().toString(36)
    .substring(2, 9)}.json`;
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
    const durationMs = new Date().getTime() - startTime;
    logger.debug(`Wrote ${rows.length} rows to ${table}`, { durationMs });
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
  const batchSize = env.analyticsUpdateBatchSize;

  try {
    const duckDbInstance = await DuckDBInstance.fromCache(':memory:');
    const duckDbConn = await duckDbInstance.connect();
    await initDbConnection(duckDbConn);

    for (const table of ALL_TABLES) {
      const startTime = new Date().getTime();
      try {
        const latestUpdateTime = await getLatestIcebergTableUpdateTime(ctx, duckDbConn, table);
        logger.debug(`=============> Table ${table} latest update time is ${latestUpdateTime.toISOString()}`);

        let cursor: RowCursor | null = null;
        let totalRows = 0;
        let rows: Array<PgRow>;

        do {
          rows = await getPostgresRows(ctx, table, latestUpdateTime.toISOString(), cursor,
            batchSize);
          if (rows.length > 0) {
            await mergeRowsIntoIceberg(ctx, duckDbConn, table, rows);
            totalRows += rows.length;

            const lastRow = rows[rows.length - 1];
            cursor = { updatedAt: lastRow.updated_at, id: lastRow.id };
          }
        } while (rows.length === batchSize);

        const durationMs = new Date().getTime() - startTime;
        logger.info(`Wrote a total of ${totalRows} rows to ${table}`, { durationMs });
      } catch (err) {
        // A failure processing one table (e.g. reading its Iceberg cutoff) must not abort
        // the rest - continue on to the remaining tables.
        logger.error(err);
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
    const startTime = new Date().getTime();
    const { logger } = ctx;
    logger.info('Started analytics cron job');
    try {
      if (env.useLocalstack) {
        process.env.AWS_ACCOUNT_ID = '000000000000';
      }
      await updateAnalytics(ctx);
      const durationMs = new Date().getTime() - startTime;
      logger.info('Completed analytics cron job', { durationMs });
    } catch (e) {
      logger.error('Failed to update analytics');
      logger.error(e);
    }
  }
}
