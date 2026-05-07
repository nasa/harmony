// Import has to happen after the knexfile, so disable that rule
import { knex, Knex } from 'knex';
import { attachPaginate } from 'knex-paginate';

import env from './env';
import logger from './log';
import knexfile from '../../../../db/knexfile';

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

  return `strftime('%Y-%m-%d %H:%M:00', ${column})`;
}

export default database;
