/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';

import { DuckDBInstance } from '@duckdb/node-api';
import { expect } from 'chai';
import * as sinon from 'sinon';

import { AnalyticsCron, ALL_TABLES, parseUtcTimestamp } from '../app/cronjobs/update-analytics';
import * as icebergConnection from '../app/util/db/iceberg-connection';
import env from '../app/util/env';

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
  const match = query.match(/read_json_auto\('([^']+)'/);
  if (!match) {
    throw new Error(`Could not find a temp file path in query: ${query}`);
  }
  return match[1];
}

describe('parseUtcTimestamp', () => {
  it('should correctly parse standard UTC timestamp without offset', () => {
    const input = '2026-09-17 20:44:08.237';
    const result = parseUtcTimestamp(input);

    expect(result).to.be.an.instanceOf(Date);
    expect(result.toISOString()).to.equal('2026-09-17T20:44:08.237Z');
  });

  it('should correctly parse UTC timestamp with +00 offset', () => {
    const input = '2026-09-17 20:50:10.179+00';
    const result = parseUtcTimestamp(input);

    expect(result).to.be.an.instanceOf(Date);
    expect(result.toISOString()).to.equal('2026-09-17T20:50:10.179Z');
  });

  it('should handle leading or trailing whitespace', () => {
    const input = '  2026-09-17 20:44:08.237  ';
    const result = parseUtcTimestamp(input);

    expect(result.toISOString()).to.equal('2026-09-17T20:44:08.237Z');
  });

  it('should throw an error for invalid date strings', () => {
    const invalidInput = 'not-a-valid-date';

    expect(() => parseUtcTimestamp(invalidInput))
      .to.throw(Error, 'Invalid date string: not-a-valid-date');
  });
});

describe('AnalyticsCron', function () {
  let sandbox: sinon.SinonSandbox;
  let ctx: any;
  let dbStub: sinon.SinonStub;
  let duckDbConn: any;
  let duckDbInstance: any;
  let fromCacheStub: sinon.SinonStub;
  let initDbConnectionStub: sinon.SinonStub;
  let originalBatchSize: number;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    originalBatchSize = env.analyticsUpdateBatchSize;
    env.analyticsUpdateBatchSize = 1000;

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
    // getPostgresRows() selects a raw "cursorUpdatedAt" column; return the SQL as-is so
    // tests can check what was selected
    (dbStub as any).raw = sandbox.stub().callsFake((sql: string) => sql);
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
    env.analyticsUpdateBatchSize = originalBatchSize;
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

      const jobsCall = dbStub.getCalls().find((c) => c.args[0] === 'jobs')!;
      const cutoff = jobsCall.returnValue.whereRaw.firstCall.args[1][0];
      expect(new Date(cutoff).getUTCFullYear()).to.be.lessThan(1900);
    });

    it('does not merge anything into Iceberg for a table with no new Postgres rows', async function () {
      await AnalyticsCron.run(ctx);

      expect(duckDbConn.run.called).to.be.false;
      expect(ctx.logger.info.calledWith('Wrote a total of 0 rows to jobs')).to.be.true;
    });

    it('queries with an interval-based cutoff (no cursor) on the first batch for a table', async function () {
      await AnalyticsCron.run(ctx);

      const jobsCall = dbStub.getCalls().find((c) => c.args[0] === 'jobs')!;
      expect(jobsCall.returnValue.orderBy.firstCall.args).to.deep.equal(['updatedAt', 'asc']);
      expect(jobsCall.returnValue.orderBy.secondCall.args).to.deep.equal(['id', 'asc']);
      expect(jobsCall.returnValue.limit.calledWith(1000)).to.be.true;
      expect(jobsCall.returnValue.whereRaw.firstCall.args[0]).to.match(/INTERVAL/);
    });

    it('selects updatedAt as full-precision text for building the paging cursor', async function () {
      await AnalyticsCron.run(ctx);

      const jobsCall = dbStub.getCalls().find((c) => c.args[0] === 'jobs')!;
      expect(jobsCall.returnValue.select.firstCall.args)
        .to.deep.equal(['*', '"updatedAt"::text AS "cursorUpdatedAt"']);
    });

    it('does not write the cursor-only cursorUpdatedAt column to Iceberg', async function () {
      let written: any;
      duckDbConn.run.callsFake(async (query: string) => {
        written = JSON.parse(fs.readFileSync(tempFilePathFromMergeQuery(query), 'utf8'));
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        {
          id: 1,
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          cursorUpdatedAt: '2024-01-01 00:00:00.000123+00',
        },
      ]));

      await AnalyticsCron.run(ctx);

      expect(written).to.deep.equal([{ id: 1, updated_at: '2024-01-01T00:00:00.000Z' }]);
    });

    it('merges a single batch of rows into Iceberg and logs the row count', async function () {
      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') },
        { id: 2, updatedAt: new Date('2024-01-02T00:00:00Z') },
      ]));

      await AnalyticsCron.run(ctx);

      expect(duckDbConn.run.calledOnce).to.be.true;
      expect(duckDbConn.run.firstCall.args[0]).to.match(/MERGE INTO catalog\.iceberg\.jobs/);
      expect(ctx.logger.info.calledWith('Wrote a total of 2 rows to jobs')).to.be.true;
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
      let tempFilePath!: string;
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
      // Every row in the first batch shares one sub-millisecond timestamp, as a single bulk
      // UPDATE would produce. A JS Date would truncate it to ...00.123, which sorts before
      // these rows, so paging from it would return this same batch forever.
      const sharedUpdatedAt = '2024-01-01 00:00:00.123456+00';
      const firstBatch = Array.from({ length: batchSize }, (_, i) => ({
        id: i + 1,
        updatedAt: new Date('2024-01-01T00:00:00.123Z'),
        cursorUpdatedAt: sharedUpdatedAt,
      }));
      const secondBatch = [{
        id: batchSize + 1,
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        cursorUpdatedAt: '2024-01-02 00:00:00+00',
      }];

      let call = 0;
      dbStub.withArgs('jobs').callsFake(() => {
        call += 1;
        return makeQueryBuilder(call === 1 ? firstBatch : secondBatch);
      });

      await AnalyticsCron.run(ctx);

      expect(dbStub.withArgs('jobs').callCount).to.equal(2);
      expect(duckDbConn.run.callCount).to.equal(2);
      expect(ctx.logger.info.calledWith('Wrote a total of 1001 rows to jobs')).to.be.true;

      // The second batch's query should page forward using the last row of the first batch.
      const secondCallBuilder = dbStub.withArgs('jobs').secondCall.returnValue;
      expect(secondCallBuilder.whereRaw.firstCall.args[0]).to.match(/\("updatedAt", id\) > /);
      expect(secondCallBuilder.whereRaw.firstCall.args[1]).to.deep.equal([sharedUpdatedAt, batchSize]);
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
      let tempFilePath!: string;
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

    it('stops paging a table after a failed merge instead of advancing past the bad batch', async function () {
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
      duckDbConn.run.withArgs(sinon.match(/catalog\.iceberg\.jobs/)).rejects(new Error('DuckDB merge failed'));

      await AnalyticsCron.run(ctx);

      // Only the first (failing) batch should ever be fetched - the do/while loop must
      // not advance its cursor past a batch that failed to merge and go on to fetch and
      // merge the next one, which would leave this batch's rows permanently un-synced
      // (see the comment above the do/while loop in updateAnalytics).
      expect(dbStub.withArgs('jobs').callCount).to.equal(1);
      expect(duckDbConn.run.callCount).to.equal(1);
      // Since the batch failed, "Wrote a total of ... rows to jobs" (logged after the
      // do/while loop completes normally) must never be reached for this table.
      // (anchored so it doesn't also match the log line for the jobs_raw_labels table)
      expect(ctx.logger.info.calledWithMatch(/^Wrote a total of .* rows to jobs$/)).to.be.false;
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
