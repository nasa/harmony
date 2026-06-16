/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */

import path from 'path';
import util from 'util';

import { stub } from 'sinon';


const exec = util.promisify(require('child_process').exec);

// Safely resolve the calling app's local db utility.
// If it doesn't exist (e.g., when running tests inside packages/util), we fall back to a mock.
let db: any;
let hasDb = false;

try {
  const dbPath = require.resolve(path.join(process.cwd(), '../../services/harmony/app/util/db'));
  db = require(dbPath).default || require(dbPath);
  hasDb = true;
} catch (e) {
  // Fallback mock so utility tests don't crash on file evaluation
  db = (): { truncate: () => Promise<void> } => ({ truncate: async (): Promise<void> => {} });
  db.transaction = async (): Promise<{ rollback: () => Promise<void> }> => ({
    rollback: async (): Promise<void> => {},
  });
}

// service_deployment is not cleared because tests rely on the existence of the row
// showing the service deployment state is set to enabled
export const tables = [
  'jobs', 'work_items', 'workflow_steps', 'job_links', 'user_work', 'job_messages', 'batches',
  'batch_items', 'raw_labels', 'jobs_raw_labels', 'users_labels', 'work_items_stats',
  'service_deployments', 'run_watermarks',
];

/**
 * Truncates all database tables
 *
 * @returns A promise that resolves to nothing on completion
 */
export async function truncateAll(): Promise<void> {
  if (!hasDb) return;
  await Promise.all(tables.map((t) => db(t).truncate()));
}

const createDatabaseCommand = '../../bin/create-database -o test';

/**
 * Recreates the test database
 * Note this is done because database migrations do not work for sqlite
 */
async function recreateDatabase(): Promise<void> {
  return exec(createDatabaseCommand);
}

// Declare global mocha methods if needed for TS compiler visibility,
// though ts-node/register usually handles this globally via mocha types.
declare const before: any;
declare const after: any;
declare const beforeEach: any;
declare const afterEach: any;

before(async function () {
  if (hasDb) {
    await recreateDatabase();
  }
});

/**
 * before/after hooks to ensure a transaction exists in `this.trx`.
 * If one already exists, does nothing.  If none exists, creates one.
 * Rolls back the transaction during the after hook
 *
 */
export function hookTransaction(): void {
  if (!hasDb) return;
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
 */
export function hookTransactionEach(): void {
  if (!hasDb) return;
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
 * Before/after hooks to have calls to interact with the database throw an exception for
 * just that test.
 *
 */
export function hookDatabaseFailure(): void {
  if (!hasDb) return;
  const originalMethods = {};
  before(function (this: any) {
    Object.keys(db).forEach(method => {
      if (typeof db[method as keyof typeof db] === 'function') {
        originalMethods[method] = db[method as keyof typeof db];
        stub(db, method as keyof typeof db).throws(new Error('DB call failed'));
      }
    });
  });

  after(function () {
    Object.keys(originalMethods).forEach(method => {
      if (db[method as keyof typeof db] && typeof db[method as keyof typeof db].restore === 'function') {
        db[method as keyof typeof db].restore();
      }
    });
  });
}
