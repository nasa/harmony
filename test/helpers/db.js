process.env.NODE_ENV = 'test'; // Ensure we're immediately using the right DB

const { before, after, beforeEach, afterEach } = require('mocha');
const db = require('../../app/util/db');

const tables = ['jobs'];

before(async function () {
  await db.migrate.latest();
  // Truncate all tables
  await Promise.all(tables.map((t) => db(t).truncate()));
});

/**
 * before/after hooks to ensure a transaction exists in `this.trx`.
 * If one already exists, does nothing.  If none exists, creates one.
 * Rolls back the transaction during the after hook
 *
 * @returns {void}
 */
function hookTransaction() {
  let transactionSet = false;
  before(async function () {
    transactionSet = !this.trx;
    this.trx = this.trx || await db.transaction();
  });

  after(async function () {
    if (transactionSet) {
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
function hookTransactionEach() {
  let transactionSet = false;
  beforeEach(async function () {
    transactionSet = !this.trx;
    this.trx = this.trx || await db.transaction();
  });

  afterEach(async function () {
    if (transactionSet) {
      await this.trx.rollback();
      delete this.trx;
    }
  });
}

module.exports = { hookTransaction, hookTransactionEach };
