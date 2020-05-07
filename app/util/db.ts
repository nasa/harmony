// Import has to happen after the knexfile, so disable that rule
// eslint-disable-next-line import/order
import knexfile from '../../db/knexfile';
import knex from 'knex';
import { attachPaginate } from 'knex-paginate';
import env from './env';

const environment = env.nodeEnv;
const config = knexfile[environment];
const database = knex(config);

attachPaginate();

export = database;
