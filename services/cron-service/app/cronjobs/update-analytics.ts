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
  // The row's "updatedAt" as Postgres text (e.g. '2026-10-15 12:00:00.123456+00'), not a
  // JS Date. Postgres timestamps have microsecond precision but a Date only has
  // milliseconds, and a truncated cursor sorts *before* the row it came from - so the
  // next query would return that row, and every other row in the same millisecond, again.
  // If a full batch shares one sub-millisecond timestamp (e.g. from a single bulk UPDATE),
  // the same batch would be returned forever.
  updatedAt: string;
  id: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>;

/**
 * A batch of rows read from Postgres, along with the cursor for its last row.
 */
interface PostgresBatch {
  rows: Array<PgRow>;
  // The cursor for the last row in `rows`, or null if `rows` is empty
  cursor: RowCursor | null;
}

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
 * @returns A Promise containing the rows retrieved from Postgres (as maps) and the cursor
 * for the last of them
 */
async function getPostgresRows(ctx: Context, table: string, latestUpdateTime: string,
  cursor: RowCursor | null, batchSize: number = 1000): Promise<PostgresBatch> {
  const { logger, db } = ctx;
  const result = new Array<PgRow>();
  let lastRowCursor: RowCursor | null = null;

  try {
    const query = db(table)
      // "cursorUpdatedAt" is only used to build the cursor (see RowCursor) and is removed
      // from each row below, so it never gets written to Iceberg
      .select('*', db.raw('"updatedAt"::text AS "cursorUpdatedAt"'))
      .orderBy('updatedAt', 'asc')
      .orderBy('id', 'asc')
      .limit(batchSize);

    if (cursor) {
      query.whereRaw('("updatedAt", id) > (?::timestamptz, ?)', [cursor.updatedAt, cursor.id]);
    } else {
      query.whereRaw('"updatedAt" >= (?::timestamptz - INTERVAL \'2 minutes\')',
        [latestUpdateTime]);
    }

    const res = await query;

    for (const pgRow of res) {
      const { cursorUpdatedAt, ...fields } = pgRow;
      const row = snakeCaseKeys(fields);
      if (tableRowTransforms[table]) {
        tableRowTransforms[table](row);
      }
      result.push(row);
      lastRowCursor = { updatedAt: cursorUpdatedAt, id: pgRow.id };
    }
  } catch (err) {
    logger.error(err);
  }
  return { rows: result, cursor: lastRowCursor };
}

// Iceberg types (as DuckDB names them) to use for each Postgres `information_schema.columns`
// `data_type` when adding a new Postgres column to an Iceberg table. Iceberg has no 16-bit
// integer, and every timestamp is stored as a timestamptz to match the existing tables (see
// bin/create-iceberg-tables) and the UTC ISO strings rows are serialized with.
const PG_TO_ICEBERG_TYPES: Record<string, string> = {
  'smallint': 'INTEGER',
  'integer': 'INTEGER',
  'bigint': 'BIGINT',
  'real': 'FLOAT',
  'double precision': 'DOUBLE',
  'numeric': 'DOUBLE',
  'boolean': 'BOOLEAN',
  'date': 'DATE',
  'timestamp with time zone': 'TIMESTAMPTZ',
  'timestamp without time zone': 'TIMESTAMPTZ',
  'text': 'VARCHAR',
  'character varying': 'VARCHAR',
  'character': 'VARCHAR',
  'uuid': 'VARCHAR',
  'USER-DEFINED': 'VARCHAR', // enums
  'json': 'VARCHAR',
  'jsonb': 'VARCHAR',
};

/**
 * Get the Iceberg column type to use for a Postgres column type
 *
 * @param pgDataType - The column's `data_type` from Postgres `information_schema.columns`
 * @returns The DuckDB name of the Iceberg type, or null if there is no known mapping
 */
export function pgTypeToIcebergType(pgDataType: string): string | null {
  return PG_TO_ICEBERG_TYPES[pgDataType] ?? null;
}

/**
 * Get the Iceberg column name for a Postgres column, using the same snake_casing that is
 * applied to each row before it is written (see getPostgresRows)
 *
 * @param pgColumnName - The Postgres column name, e.g. 'jobID'
 * @returns The Iceberg column name, e.g. 'job_id'
 */
function toIcebergColumnName(pgColumnName: string): string {
  return Object.keys(snakeCaseKeys({ [pgColumnName]: null }))[0];
}

/**
 * Quote a column name for use as an identifier in a DuckDB query
 *
 * @param name - The column name
 * @returns The quoted identifier
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Add any columns that exist on the Postgres table but not on the corresponding Iceberg
 * table to the Iceberg table, so that new Postgres columns (from a migration) get written
 * instead of failing the merge.
 *
 * Columns removed from Postgres are deliberately NOT dropped from Iceberg: dropping an
 * Iceberg column hides that column's history for every existing row, and can't be undone by
 * adding the column back (it would get a new field id). mergeRowsIntoIceberg only writes the
 * columns Postgres still has, so the old column just stops being populated for new rows.
 *
 * @param ctx - The Cron job context
 * @param duckDbConn - A connection to the Iceberg database
 * @param table - The name of the table to sync
 * @returns a Promise that resolves when any missing columns have been added
 * @throws error if either schema can't be read or a column can't be added
 */
async function addMissingIcebergColumns(ctx: Context, duckDbConn: DuckDBConnection,
  table: string): Promise<void> {
  const { logger, db } = ctx;

  const pgColumns: Array<{ column_name: string, data_type: string }> = await db('information_schema.columns')
    .select('column_name', 'data_type')
    .where('table_name', table)
    .whereRaw('table_schema = current_schema()');
  if (pgColumns.length === 0) {
    logger.warn(`Could not read Postgres columns for ${table}, skipping Iceberg schema update`);
    return;
  }

  const reader = await duckDbConn.runAndReadAll(`DESCRIBE catalog.iceberg.${table};`);
  const icebergColumns = new Set(reader.getRowObjectsJson().map((row) => String(row.column_name)));

  for (const { column_name: pgName, data_type: pgType } of pgColumns) {
    const name = toIcebergColumnName(pgName);
    if (icebergColumns.has(name)) continue;

    let type = pgTypeToIcebergType(pgType);
    if (!type) {
      logger.warn(`No Iceberg type mapping for Postgres type ${pgType} of ${table}.${pgName}, using VARCHAR`);
      type = 'VARCHAR';
    }
    await duckDbConn.run(`ALTER TABLE catalog.iceberg.${table} ADD COLUMN ${quoteIdentifier(name)} ${type};`);
    logger.info(`Added column ${name} (${type}) to Iceberg table ${table}`);
  }
}

/**
 * Parse a datetime string for a UTC time into a Date
 * @param dateString - the string to parse
 * @returns the Date object for the UTC timestamp
 */
export function parseUtcTimestamp(dateString: string): Date {
  let formatted = dateString.trim().replace(' ', 'T');

  // Handle "+00" or explicit offset at the end
  if (formatted.endsWith('+00')) {
    formatted = formatted.slice(0, -3) + 'Z';
  } else if (!formatted.endsWith('Z')) {
    const offset = formatted.match(/([+-])(\d{2})(?::?(\d{2}))?$/);
    if (offset && formatted.includes('T')) {
      formatted = formatted.slice(0, -offset[0].length)
        + `${offset[1]}${offset[2]}:${offset[3] ?? '00'}`;
    } else {
      formatted += 'Z';
    }
  }

  const date = new Date(formatted);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`);
  }

  return date;
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
      return parseUtcTimestamp(updatedAt);
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
    // Name the columns explicitly rather than using UPDATE SET * / INSERT BY NAME, so only the
    // columns Postgres currently has are written. The Iceberg table can also have columns that
    // have since been dropped from Postgres (see addMissingIcebergColumns) - these are left
    // as-is on updated rows, and NULL on inserted ones.
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(quoteIdentifier);
    const updates = columns.filter((c) => c !== '"id"').map((c) => `${c} = upserts.${c}`);
    const insertValues = columns.map((c) => `upserts.${c}`);
    // sample_size = -1 forces DuckDB to infer each column's type from every record in
    // the batch instead of its default ~20480-row sample. With the large batch sizes
    // this job uses, sampling can miss a column whose true shape only shows up later in
    // the file (e.g. a free-form scrollID that happens to look numeric in the sampled
    // rows), causing DuckDB to infer the wrong type and then throw a conversion error
    // (e.g. "Could not convert string ... to INT128") on a row outside the sample -
    // aborting the write for the *entire* batch, not just that row.
    const query = `MERGE INTO catalog.iceberg.${table} AS target
	         			   USING (
	         			     SELECT * FROM read_json_auto('${tempFilePath}', sample_size = -1)
	         			   ) as upserts
	         			   ON target.id = upserts.id
	         			   WHEN MATCHED THEN
	         			     UPDATE SET ${updates.join(', ')}
	         			   WHEN NOT MATCHED THEN
	         			     INSERT (${columns.join(', ')}) VALUES (${insertValues.join(', ')});`;
    await duckDbConn.run(query);
    const durationMs = new Date().getTime() - startTime;
    logger.info(`Wrote ${rows.length} rows to ${table}`, { durationMs });
  } finally {
    // Ensure temporary file is cleaned up even if duckDbConn throws. Deliberately no
    // catch around the write itself: a failed merge must propagate to the caller so it
    // does NOT advance its paging cursor past this batch (see the do/while loop in
    // updateAnalytics below). If it were swallowed here, a later batch for the same
    // table could still succeed and push the Iceberg table's max(updated_at) past this
    // batch's rows - and since the next cron run resumes from that max(updated_at),
    // this batch's rows would never be looked at again.
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
        // Throws if the schema can't be updated, skipping this table until the next run rather
        // than attempting merges that would fail on the missing columns
        await addMissingIcebergColumns(ctx, duckDbConn, table);
        const latestUpdateTime = await getLatestIcebergTableUpdateTime(ctx, duckDbConn, table);
        logger.info(`=============> Table ${table} latest update time is ${latestUpdateTime.toISOString()}`);

        let cursor: RowCursor | null = null;
        let totalRows = 0;
        let rows: Array<PgRow>;
        let lastRowCursor: RowCursor | null;

        do {
          ({ rows, cursor: lastRowCursor } = await getPostgresRows(ctx, table,
            latestUpdateTime.toISOString(), cursor, batchSize));
          if (rows.length > 0) {
            // mergeRowsIntoIceberg throws on failure. Advancing the cursor only happens
            // below this line, so a failed batch stops pagination for this table (via
            // the catch below) without being marked as done. That keeps the invariant
            // that this table's max(updated_at) in Iceberg always reflects a contiguous
            // run of successfully-written rows, which is what lets the next cron tick's
            // getLatestIcebergTableUpdateTime()-based cutoff correctly retry this batch
            // instead of skipping past it forever.
            await mergeRowsIntoIceberg(ctx, duckDbConn, table, rows);
            totalRows += rows.length;
            cursor = lastRowCursor;
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
