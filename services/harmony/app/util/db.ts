import { knex, Knex } from 'knex';
import { attachPaginate } from 'knex-paginate';
import { types as pgTypes } from 'pg';

import env from './env';
import logger from './log';
import knexfile from '../../../../db/knexfile';

// node-pg returns int8/bigint as a string to avoid precision loss. Harmony's bigint
// columns (workflow_steps.maxBatchSizeInBytes) stay well inside Number.MAX_SAFE_INTEGER,
// so parse them as numbers.
pgTypes.setTypeParser(pgTypes.builtins.INT8, (val) => parseInt(val, 10));

/**
 * Batch size -- to avoid overly large SQL statements.
 */
export const batchSize = env.nodeEnv === 'development' ? 100 : 2000;

export type Transaction = Knex.Transaction | Knex;

const database = knex(knexfile);

// attachPaginate will fail when code is reloaded by mocha -w
try {
  attachPaginate();
} catch (e) {
  if ((e.message as string).startsWith('Can\'t extend QueryBuilder with existing method (\'paginate\')')) {
    logger.warn(e.message);
  } else {
    throw e;
  }
}

/**
 * Account for Postgres and sqlite differences in getting the current time
 *
 * @param db - the database connection
 *
 * @returns the current time
 */
export async function getCurrentTime(db: Transaction): Promise<Date> {
  if (db.client.config.client === 'pg') {
    const result = await db.raw<{ rows: { now: Date }[] }>('SELECT NOW() as now');
    return result.rows[0].now;
  }

  const result = await db.raw("SELECT STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') as now");
  return new Date(result[0].now);
}

/**
 * Account for Postgres and sqlite differences in date truncation
 *
 * @param db - the database connection
 * @param column - the column name to truncate on
 *
 * @returns the date represented in the column truncated to the nearest minute
 */
export function truncateMinuteSql(db: Transaction, column: string): string {
  if (db.client.config.client === 'pg') {
    return `date_trunc('minute', ${column})`;
  }

  // SQLite: handle both ISO strings AND integer ms-epoch (how Knex stores Date columns).
  // CASE picks the right interpretation based on the value's type.
  return 'strftime(\'%Y-%m-%d %H:%M:00\', ' +
    `CASE WHEN typeof(${column}) = 'integer' ` +
    `THEN datetime(${column} / 1000, 'unixepoch') ` +
    `ELSE ${column} END)`;
}

/**
 * Account for Postgres and sqlite differences in converting a timestamp column to milliseconds
 * since the epoch
 *
 * @param db - the database connection
 * @param column - the (quoted, if needed) column name
 *
 * @returns SQL evaluating to the column's value in milliseconds since the epoch
 */
export function epochMsSql(db: Transaction, column: string): string {
  if (db.client.config.client === 'pg') {
    return `(EXTRACT(EPOCH FROM ${column}) * 1000)`;
  }

  // SQLite: handle both ISO strings AND integer ms-epoch (how Knex stores Date columns)
  return `(CASE WHEN typeof(${column}) = 'integer' THEN ${column} `
    + `ELSE CAST(ROUND((julianday(${column}) - 2440587.5) * 86400000) AS INTEGER) END)`;
}

/**
 * Account for Postgres and sqlite differences in computing the time between two timestamp columns
 *
 * @param db - the database connection
 * @param startColumn - the (quoted, if needed) column with the earlier time
 * @param endColumn - the (quoted, if needed) column with the later time
 *
 * @returns SQL evaluating to the number of milliseconds from startColumn to endColumn
 */
export function durationMsSql(db: Transaction, startColumn: string, endColumn: string): string {
  return `(${epochMsSql(db, endColumn)} - ${epochMsSql(db, startColumn)})`;
}

export default database;
