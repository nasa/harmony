// Import has to happen after the knexfile, so disable that rule
// eslint-disable-next-line import/order
import knexfile from '../../db/knexfile';
import { knex, Knex } from 'knex';
import { attachPaginate } from 'knex-paginate';
import { env } from '@harmony/util';
import logger from './log';

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

export default database;
