// Ensure we're immediately using the right DB

import { before, after, beforeEach, afterEach } from 'mocha';
import { stub } from 'sinon';

import db from 'harmony/util/db';

import { exec } from 'child_process';
import logger from 'harmony/util/log';

const tables = ['jobs'];

/**
 * Truncates all database tables
 *
 * @returns {Promise<void>} A promise that resolves to nothing on completion
 */
export async function truncateAll(): Promise<void> {
  await Promise.all(tables.map((t) => db(t).truncate()));
}

const createDatabaseCommand = './bin/create-database -o test';

/**
 * Recreates the test database
 * Note this is done because database migrations do not work for sqlite
 */
function recreateDatabase(): void {
  exec(createDatabaseCommand, (error, stdout, stderr) => {
    if (error) {
      logger.warn(`Failed to recreate database: [${error}]`);
      logger.warn(`create database stdout: [${stdout}]`);
      logger.warn(`create database stderr: [${stderr}]`);
    }
  });
}

before(async function () {
  recreateDatabase();
});

/**
 * before/after hooks to ensure a transaction exists in `this.trx`.
 * If one already exists, does nothing.  If none exists, creates one.
 * Rolls back the transaction during the after hook
 *
 * @returns {void}
 */
export function hookTransaction(): void {
  let transactionSet = false;
  before(async function () {
    transactionSet = !this.trx;
    this.trx = this.trx || await db.transaction();
  });

  after(async function () {
    if (transactionSet && this.trx) {
      await this.trx.rollback();
      delete this.trx;
    }
  });
}

/**
 * beforeEach/afterEach hooks to ensure a transaction exists in `this.trx`.
 * If one already exists, does nothing.  If none exists, creates one.
 * Rolls back the transaction during the after hook
 *
 * @returns {void}
 */
export function hookTransactionEach(): void {
  let transactionSet = false;
  beforeEach(async function () {
    transactionSet = !this.trx;
    this.trx = this.trx || await db.transaction();
  });

  afterEach(async function () {
    if (transactionSet && this.trx) {
      await this.trx.rollback();
      delete this.trx;
    }
  });
}

/**
 * Before/after hooks to have calls to create a database transaction throw an exception for
 * just that test.
 *
 * @returns {void}
 */
export function hookTransactionFailure(): void {
  let txStub;
  before(function () {
    txStub = stub(db, 'transaction').throws();
  });
  after(function () {
    txStub.restore();
  });
}
