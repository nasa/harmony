// Import has to happen after the knexfile, so disable that rule
// eslint-disable-next-line import/order
import knexfile from '../../db/knexfile';
import knex from 'knex';
import { attachPaginate } from 'knex-paginate';
import env from './env';
import logger from './log';

export type Transaction = knex.Transaction | knex;

const environment = env.nodeEnv;
const config = knexfile[environment];
const database = knex(config);

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
