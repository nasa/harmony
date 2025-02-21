import { Knex } from 'knex';
import winston from 'winston';

// shared context for cron jobs
export type Context = {
  logger: winston.Logger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: Knex<any, unknown[]>;
};