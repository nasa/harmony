/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';

import { DuckDBInstance } from '@duckdb/node-api';
import { expect } from 'chai';
import * as sinon from 'sinon';

import { AnalyticsCron } from '../app/cronjobs/update-analytics';
import * as icebergConnection from '../app/util/db/iceberg-connection';

// This is the exact table list and order used by updateAnalytics() in update-analytics.ts.
const ALL_TABLES = [
  'batch_items', 'batches', 'job_links', 'job_messages', 'jobs', 'jobs_raw_labels',
  'raw_labels', 'service_deployments', 'users_labels', 'work_items', 'workflow_steps',
];

/**
 * Build a fake Knex-style query builder: a Promise (that resolves to `rows`, or rejects if
 * `rows` is an Error) decorated with chainable, no-op stand-ins for the query methods
 * getPostgresRows() calls (select/orderBy/limit/whereRaw). Using a real Promise means
 * `await` on it behaves exactly like the real query builder would, with no ministack or
 * real database involved.
 */
function makeQueryBuilder(rows: Record<string, any>[] | Error): any {
  const promise: any = rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  promise.select = sinon.stub().returns(promise);
  promise.orderBy = sinon.stub().returns(promise);
  promise.limit = sinon.stub().returns(promise);
  promise.whereRaw = sinon.stub().returns(promise);
  return promise;
}

/**
 * mergeRowsIntoIceberg() writes its batch to a local temp JSON file and references it in the
 * MERGE query it hands to DuckDB via `read_json_auto('<path>')`. Pull that path back out of
 * the query so tests can inspect what was actually written, without needing to spy on `fs`
 * itself (its named exports are non-configurable getters under this project's TS/Node
 * interop settings, which Sinon refuses to wrap).
 */
function tempFilePathFromMergeQuery(query: string): string {
  return query.match(/read_json_auto\('([^']+)'\)/)[1];
}

describe('AnalyticsCron', function () {
  let sandbox: sinon.SinonSandbox;
  let ctx: any;
  let dbStub: sinon.SinonStub;
  let duckDbConn: any;
  let duckDbInstance: any;
  let fromCacheStub: sinon.SinonStub;
  let initDbConnectionStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    ctx = {
      logger: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // By default every table's Postgres query returns no rows, so each table
    // finishes in a single (empty) batch and nothing gets merged into Iceberg.
    dbStub = sandbox.stub().callsFake(() => makeQueryBuilder([]));
    ctx.db = dbStub;

    duckDbConn = {
      runAndReadAll: sandbox.stub().resolves({
        getRowObjectsJson: () => [{ 'max(updated_at)': '2020-01-01T00:00:00.000Z' }],
      }),
      run: sandbox.stub().resolves(),
    };

    duckDbInstance = { connect: sandbox.stub().resolves(duckDbConn) };

    fromCacheStub = sandbox.stub(DuckDBInstance, 'fromCache').resolves(duckDbInstance);
    initDbConnectionStub = sandbox.stub(icebergConnection, 'initDbConnection').resolves();
  });

  afterEach(function () {
    sandbox.restore();
    delete process.env.AWS_ACCOUNT_ID;
  });

  describe('run', function () {
    it('logs start and completion on success', async function () {
      await AnalyticsCron.run(ctx);

      expect(ctx.logger.info.calledWith('Started analytics cron job')).to.be.true;
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });

    it('sets AWS_ACCOUNT_ID for the DuckDB credential chain', async function () {
      await AnalyticsCron.run(ctx);

      expect(process.env.AWS_ACCOUNT_ID).to.equal('000000000000');
    });

    it('creates a fresh in-memory DuckDB connection and initializes it via initDbConnection', async function () {
      await AnalyticsCron.run(ctx);

      expect(fromCacheStub.calledWith(':memory:')).to.be.true;
      expect(duckDbInstance.connect.calledOnce).to.be.true;
      expect(initDbConnectionStub.calledOnceWith(duckDbConn)).to.be.true;
    });

    it('queries Postgres for every configured analytics table, in order', async function () {
      await AnalyticsCron.run(ctx);

      const queriedTables = dbStub.getCalls().map((c) => c.args[0]);
      expect(queriedTables).to.deep.equal(ALL_TABLES);
    });

    it('reads the latest Iceberg updated_at for each table before querying Postgres', async function () {
      await AnalyticsCron.run(ctx);

      expect(duckDbConn.runAndReadAll.callCount).to.equal(ALL_TABLES.length);
      expect(duckDbConn.runAndReadAll.firstCall.args[0]).to.match(/catalog\.iceberg\.batch_items/);
    });

    it('falls back to an old cutoff date when the Iceberg table has no rows yet', async function () {
      duckDbConn.runAndReadAll.resolves({ getRowObjectsJson: () => [] });

      await AnalyticsCron.run(ctx);

      const jobsCall = dbStub.getCalls().find((c) => c.args[0] === 'jobs');
      const cutoff = jobsCall.returnValue.whereRaw.firstCall.args[1][0];
      expect(new Date(cutoff).getUTCFullYear()).to.be.lessThan(1900);
    });

    it('does not merge anything into Iceberg for a table with no new Postgres rows', async function () {
      await AnalyticsCron.run(ctx);

      expect(duckDbConn.run.called).to.be.false;
      expect(ctx.logger.debug.calledWith('Wrote a total of 0 rows to jobs')).to.be.true;
    });

    it('queries with an interval-based cutoff (no cursor) on the first batch for a table', async function () {
      await AnalyticsCron.run(ctx);

      const jobsCall = dbStub.getCalls().find((c) => c.args[0] === 'jobs');
      expect(jobsCall.returnValue.orderBy.firstCall.args).to.deep.equal(['updatedAt', 'asc']);
      expect(jobsCall.returnValue.orderBy.secondCall.args).to.deep.equal(['id', 'asc']);
      expect(jobsCall.returnValue.limit.calledWith(1000)).to.be.true;
      expect(jobsCall.returnValue.whereRaw.firstCall.args[0]).to.match(/INTERVAL/);
    });

    it('merges a single batch of rows into Iceberg and logs the row count', async function () {
      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') },
        { id: 2, updatedAt: new Date('2024-01-02T00:00:00Z') },
      ]));

      await AnalyticsCron.run(ctx);

      expect(duckDbConn.run.calledOnce).to.be.true;
      expect(duckDbConn.run.firstCall.args[0]).to.match(/MERGE INTO catalog\.iceberg\.jobs/);
      expect(ctx.logger.debug.calledWith('Wrote a total of 2 rows to jobs')).to.be.true;
    });

    it('writes snake_cased rows to the temp file merged into DuckDB', async function () {
      let written: any;
      duckDbConn.run.callsFake(async (query: string) => {
        written = JSON.parse(fs.readFileSync(tempFilePathFromMergeQuery(query), 'utf8'));
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z'), requestId: 'req-1' },
      ]));

      await AnalyticsCron.run(ctx);

      expect(written).to.deep.equal([{ id: 1, updated_at: '2024-01-01T00:00:00.000Z', request_id: 'req-1' }]);
    });

    it('strips the access token from workflow_steps rows before merging into Iceberg', async function () {
      const operation = JSON.stringify({ accessToken: 'super-secret', other: 'value' });
      let written: any;
      duckDbConn.run.callsFake(async (query: string) => {
        written = JSON.parse(fs.readFileSync(tempFilePathFromMergeQuery(query), 'utf8'));
      });

      dbStub.withArgs('workflow_steps').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z'), operation },
      ]));

      await AnalyticsCron.run(ctx);

      const [writtenRow] = written;
      const writtenOperation = JSON.parse(writtenRow.operation);
      expect(writtenOperation).to.deep.equal({ other: 'value' });
    });

    it('cleans up the temp file used to merge rows into Iceberg', async function () {
      let tempFilePath: string;
      duckDbConn.run.callsFake(async (query: string) => {
        tempFilePath = tempFilePathFromMergeQuery(query);
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') },
      ]));

      await AnalyticsCron.run(ctx);

      expect(tempFilePath).to.be.a('string');
      expect(fs.existsSync(tempFilePath)).to.be.false;
    });

    it('pages through multiple batches using the last row as a cursor, until a short batch ends it', async function () {
      const batchSize = 1000;
      const firstBatch = Array.from({ length: batchSize }, (_, i) => ({
        id: i + 1,
        updatedAt: new Date(2024, 0, 1),
      }));
      const secondBatch = [{ id: batchSize + 1, updatedAt: new Date(2024, 0, 2) }];

      let call = 0;
      dbStub.withArgs('jobs').callsFake(() => {
        call += 1;
        return makeQueryBuilder(call === 1 ? firstBatch : secondBatch);
      });

      await AnalyticsCron.run(ctx);

      expect(dbStub.withArgs('jobs').callCount).to.equal(2);
      expect(duckDbConn.run.callCount).to.equal(2);
      expect(ctx.logger.debug.calledWith('Wrote a total of 1001 rows to jobs')).to.be.true;

      // The second batch's query should page forward using the last row of the first batch.
      const secondCallBuilder = dbStub.withArgs('jobs').secondCall.returnValue;
      expect(secondCallBuilder.whereRaw.firstCall.args[0]).to.match(/\("updatedAt", id\) > /);
      expect(secondCallBuilder.whereRaw.firstCall.args[1][1]).to.equal(batchSize);
    });

    it('logs an error and continues (as zero rows) when a Postgres query fails for a table', async function () {
      const pgError = new Error('Postgres connection lost');
      dbStub.withArgs('jobs').returns(makeQueryBuilder(pgError));

      await AnalyticsCron.run(ctx);

      expect(ctx.logger.error.calledWith(pgError)).to.be.true;
      expect(duckDbConn.run.called).to.be.false;
      // The rest of the run still completes normally.
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });

    it('logs an error and still cleans up the temp file when the Iceberg merge fails', async function () {
      const mergeError = new Error('DuckDB merge failed');
      let tempFilePath: string;
      duckDbConn.run.callsFake(async (query: string) => {
        tempFilePath = tempFilePathFromMergeQuery(query);
        throw mergeError;
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') },
      ]));

      await AnalyticsCron.run(ctx);

      expect(ctx.logger.error.calledWith(mergeError)).to.be.true;
      expect(tempFilePath).to.be.a('string');
      expect(fs.existsSync(tempFilePath)).to.be.false;
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });

    it('completes without throwing even if establishing the DuckDB connection fails', async function () {
      fromCacheStub.rejects(new Error('DuckDB unavailable'));

      await AnalyticsCron.run(ctx);

      expect(ctx.logger.error.called).to.be.true;
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });

    it('logs an error when reading a table current Iceberg update time fails, and still processes the remaining tables', async function () {
      const readError = new Error('Iceberg read failed');
      // ALL_TABLES[0] is 'batch_items' - fail only its Iceberg cutoff read.
      duckDbConn.runAndReadAll.onFirstCall().rejects(readError);

      await AnalyticsCron.run(ctx);

      expect(ctx.logger.error.calledWith(readError)).to.be.true;
      // A failure processing one table must not abort the whole run - every table is
      // still queried against Postgres, including the ones after the failing one.
      const queriedTables = dbStub.getCalls().map((c) => c.args[0]);
      expect(queriedTables).to.deep.equal(ALL_TABLES);
      // updateAnalytics() never rejects (it catches and logs internally), so run() always
      // reaches its own completion log regardless of what happened while processing tables.
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });
  });
});
