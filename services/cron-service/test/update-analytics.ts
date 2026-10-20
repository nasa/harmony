/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import { tmpdir } from 'os';

import { DuckDBInstance } from '@duckdb/node-api';
import { expect } from 'chai';
import * as sinon from 'sinon';

import {
  AnalyticsCron, ALL_TABLES, parseUtcTimestamp, pgTypeToIcebergType, SLOW_PHASE_WARNING_MS,
} from '../app/cronjobs/update-analytics';
import * as icebergConnection from '../app/util/db/iceberg-connection';
import env from '../app/util/env';

/**
 * Build a fake Knex-style query builder: a Promise (that resolves to `rows`, or rejects if
 * `rows` is an Error, or settles with `rows` if it is itself a Promise) decorated with
 * chainable, no-op stand-ins for the query methods getPostgresRows() calls
 * (select/orderBy/limit/whereRaw). Using a real Promise means `await` on it behaves exactly
 * like the real query builder would, with no ministack or real database involved.
 */
function makeQueryBuilder(rows: Record<string, any>[] | Error | Promise<Record<string, any>[]>): any {
  const promise: any = rows instanceof Error ? Promise.reject(rows) : rows instanceof Promise
    ? rows.then((r) => r) : Promise.resolve(rows);
  promise.select = sinon.stub().returns(promise);
  promise.orderBy = sinon.stub().returns(promise);
  promise.limit = sinon.stub().returns(promise);
  promise.whereRaw = sinon.stub().returns(promise);
  promise.where = sinon.stub().returns(promise);
  return promise;
}

/**
 * Build a fake Knex-style query builder for addMissingIcebergColumns()'s
 * `information_schema.columns` query. Unlike makeQueryBuilder, what it resolves to depends
 * on the `where('table_name', ...)` it's given, so it's only evaluated when awaited.
 */
function makeColumnsQueryBuilder(
  columnsByTable: Record<string, Array<{ column_name: string, data_type: string }>>,
): any {
  let tableName: string;
  const builder: any = {};
  builder.select = sinon.stub().returns(builder);
  builder.whereRaw = sinon.stub().returns(builder);
  builder.where = sinon.stub().callsFake((column: string, value: string) => {
    if (column === 'table_name') tableName = value;
    return builder;
  });
  builder.then = (resolve: any, reject: any): Promise<any> =>
    Promise.resolve(columnsByTable[tableName] ?? []).then(resolve, reject);
  return builder;
}

/**
 * Get the names of the Postgres data tables queried, leaving out the
 * `information_schema.columns` and `pg_attribute` queries used to sync the Iceberg schema
 */
function queriedDataTables(dbStub: sinon.SinonStub): string[] {
  return dbStub.getCalls().map((c) => c.args[0])
    .filter((t) => t !== 'information_schema.columns' && t !== 'pg_attribute');
}

/**
 * mergeRowsIntoIceberg() writes its batch to a local temp NDJSON file and references it in the
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

/**
 * Read back the rows mergeRowsIntoIceberg() wrote to its newline-delimited JSON temp file
 */
function readNdjsonFile(filePath: string): any[] {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/**
 * List the temp files mergeRowsIntoIceberg() has left behind in the OS temp directory
 */
function leftoverTempFiles(): string[] {
  return fs.readdirSync(tmpdir()).filter((name) => name.startsWith('temp-data-'));
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

describe('pgTypeToIcebergType', () => {
  it('maps Postgres column types to Iceberg types', () => {
    expect(pgTypeToIcebergType('integer')).to.equal('INTEGER');
    expect(pgTypeToIcebergType('bigint')).to.equal('BIGINT');
    expect(pgTypeToIcebergType('double precision')).to.equal('DOUBLE');
    expect(pgTypeToIcebergType('boolean')).to.equal('BOOLEAN');
    expect(pgTypeToIcebergType('character varying')).to.equal('VARCHAR');
    expect(pgTypeToIcebergType('USER-DEFINED')).to.equal('VARCHAR');
  });

  it('maps every Postgres timestamp type to a timestamptz', () => {
    expect(pgTypeToIcebergType('timestamp with time zone')).to.equal('TIMESTAMPTZ');
    expect(pgTypeToIcebergType('timestamp without time zone')).to.equal('TIMESTAMPTZ');
  });

  it('returns null for an unmapped type', () => {
    expect(pgTypeToIcebergType('ARRAY')).to.be.null;
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
  let originalPageSize: number;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    originalBatchSize = env.analyticsUpdateBatchSize;
    originalPageSize = env.analyticsUpdatePageSize;
    env.analyticsUpdateBatchSize = 1000;
    // Larger than the batch size, so each batch is read in a single page unless a test says otherwise
    env.analyticsUpdatePageSize = 5000;

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
    env.analyticsUpdatePageSize = originalPageSize;
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

      expect(queriedDataTables(dbStub)).to.deep.equal(ALL_TABLES);
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
      expect(ctx.logger.info.calledWith('Analytics Cron Wrote a total of 0 rows to jobs')).to.be.true;
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
        written = readNdjsonFile(tempFilePathFromMergeQuery(query));
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
      expect(ctx.logger.info.calledWith('Analytics Cron Wrote a total of 2 rows to jobs')).to.be.true;
    });

    describe('when timing each phase of a batch', function () {
      let clock: sinon.SinonFakeTimers;

      beforeEach(function () {
        // Only fake the clock and timers - the batch is still really written to a temp file
        clock = sandbox.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        dbStub.withArgs('jobs').returns(makeQueryBuilder([
          { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') },
        ]));
      });

      it('logs how long reading the batch from Postgres and merging it into Iceberg each took', async function () {
        duckDbConn.run.withArgs(sinon.match(/MERGE INTO/)).callsFake(() => clock.tickAsync(2000));

        await AnalyticsCron.run(ctx);

        expect(ctx.logger.info.calledWith('Wrote 1 rows to jobs', sinon.match({
          durationMs: 2000, pgReadMs: 0, mergeMs: 2000,
        }))).to.be.true;
        expect(ctx.logger.warn.calledWithMatch(/still running/)).to.be.false;
      });

      it('warns while a merge into Iceberg is still running after the slow phase threshold', async function () {
        let warnedDuringMerge = false;
        duckDbConn.run.withArgs(sinon.match(/MERGE INTO/)).callsFake(async () => {
          await clock.tickAsync(SLOW_PHASE_WARNING_MS);
          warnedDuringMerge = ctx.logger.warn.calledWith(
            'Merging 1 rows into Iceberg table jobs is still running after 5 minutes');
        });

        await AnalyticsCron.run(ctx);

        expect(warnedDuringMerge).to.be.true;
        expect(ctx.logger.info.calledWith('Wrote 1 rows to jobs', sinon.match({
          mergeMs: SLOW_PHASE_WARNING_MS,
        }))).to.be.true;
      });

      it('warns while a Postgres read is still running after the slow phase threshold', async function () {
        let readStarted!: () => void;
        const started = new Promise<void>((resolve) => { readStarted = resolve; });
        let resolveRows!: (rows: Record<string, any>[]) => void;
        const rows = new Promise<Record<string, any>[]>((resolve) => { resolveRows = resolve; });
        dbStub.withArgs('jobs').callsFake(() => {
          readStarted();
          return makeQueryBuilder(rows);
        });

        const run = AnalyticsCron.run(ctx);
        await started;
        await clock.tickAsync(SLOW_PHASE_WARNING_MS);

        expect(ctx.logger.warn.calledWith(
          'Reading the next batch of jobs from Postgres is still running after 5 minutes')).to.be.true;
        resolveRows([{ id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') }]);
        await run;
        expect(ctx.logger.info.calledWith('Wrote 1 rows to jobs', sinon.match({
          pgReadMs: SLOW_PHASE_WARNING_MS,
        }))).to.be.true;
      });

      it('stops the slow phase warning once the phase completes', async function () {
        await AnalyticsCron.run(ctx);
        await clock.tickAsync(SLOW_PHASE_WARNING_MS);

        expect(ctx.logger.warn.calledWithMatch(/still running/)).to.be.false;
      });
    });

    it('writes snake_cased rows to the temp file merged into DuckDB', async function () {
      let written: any;
      duckDbConn.run.callsFake(async (query: string) => {
        written = readNdjsonFile(tempFilePathFromMergeQuery(query));
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z'), requestId: 'req-1' },
      ]));

      await AnalyticsCron.run(ctx);

      expect(written).to.deep.equal([{ id: 1, updated_at: '2024-01-01T00:00:00.000Z', request_id: 'req-1' }]);
    });

    it('writes the temp file as newline-delimited JSON, one row per line, and reads it as such', async function () {
      let query!: string;
      let contents!: string;
      duckDbConn.run.callsFake(async (q: string) => {
        query = q;
        contents = fs.readFileSync(tempFilePathFromMergeQuery(q), 'utf8');
      });

      dbStub.withArgs('jobs').returns(makeQueryBuilder([
        { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z'), message: 'line one\nline two' },
        { id: 2, updatedAt: new Date('2024-01-02T00:00:00Z'), message: 'second' },
      ]));

      await AnalyticsCron.run(ctx);

      expect(query).to.match(/read_json_auto\('[^']+', format = 'newline_delimited', sample_size = -1\)/);
      // Newlines inside values are escaped by JSON.stringify, so they can't split a row
      expect(contents).to.equal(
        '{"id":1,"updated_at":"2024-01-01T00:00:00.000Z","message":"line one\\nline two"}\n'
        + '{"id":2,"updated_at":"2024-01-02T00:00:00.000Z","message":"second"}\n',
      );
    });

    it('does not merge, cleans up the temp file, and stops paging a table when writing the temp file fails', async function () {
      const tempFilesBefore = leftoverTempFiles();
      // A full batch, so paging would go on to fetch another one if this batch were treated as done
      const firstBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        cursorUpdatedAt: '2024-01-01 00:00:00+00',
      }));
      // JSON.stringify throws on a BigInt, failing the write partway through the batch
      (firstBatch[500] as any).bad = BigInt(1);
      dbStub.withArgs('jobs').callsFake(() => makeQueryBuilder(firstBatch));

      await AnalyticsCron.run(ctx);

      expect(ctx.logger.error.calledWithMatch(sinon.match.instanceOf(TypeError))).to.be.true;
      expect(duckDbConn.run.calledWithMatch(/catalog\.iceberg\.jobs /)).to.be.false;
      expect(dbStub.withArgs('jobs').callCount).to.equal(1);
      expect(ctx.logger.info.calledWithMatch(/^Analytics Cron Wrote a total of .* rows to jobs$/)).to.be.false;
      expect(leftoverTempFiles()).to.deep.equal(tempFilesBefore);
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });

    it('strips the access token from workflow_steps rows before merging into Iceberg', async function () {
      const operation = JSON.stringify({ accessToken: 'super-secret', other: 'value' });
      let written: any;
      duckDbConn.run.callsFake(async (query: string) => {
        written = readNdjsonFile(tempFilePathFromMergeQuery(query));
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
      expect(ctx.logger.info.calledWith('Analytics Cron Wrote a total of 1001 rows to jobs')).to.be.true;

      // The second batch's query should page forward using the last row of the first batch.
      const secondCallBuilder = dbStub.withArgs('jobs').secondCall.returnValue;
      expect(secondCallBuilder.whereRaw.firstCall.args[0]).to.match(/\("updatedAt", id\) > /);
      expect(secondCallBuilder.whereRaw.firstCall.args[1]).to.deep.equal([sharedUpdatedAt, batchSize]);
    });

    it('reads each batch from Postgres a page at a time, and merges the pages as a single batch', async function () {
      env.analyticsUpdateBatchSize = 3;
      env.analyticsUpdatePageSize = 2;
      const pages = [
        [
          { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z'), cursorUpdatedAt: '2024-01-01 00:00:00+00' },
          { id: 2, updatedAt: new Date('2024-01-02T00:00:00Z'), cursorUpdatedAt: '2024-01-02 00:00:00+00' },
        ],
        // The remainder of the first batch - only 1 row is asked for, to stop at the batch size
        [{ id: 3, updatedAt: new Date('2024-01-03T00:00:00Z'), cursorUpdatedAt: '2024-01-03 00:00:00+00' }],
        // A short page, ending the second batch and paging for the table
        [{ id: 4, updatedAt: new Date('2024-01-04T00:00:00Z'), cursorUpdatedAt: '2024-01-04 00:00:00+00' }],
      ];
      let call = 0;
      dbStub.withArgs('jobs').callsFake(() => makeQueryBuilder(pages[call++] ?? []));
      const merged: any[][] = [];
      duckDbConn.run.callsFake(async (query: string) => {
        merged.push(readNdjsonFile(tempFilePathFromMergeQuery(query)).map((row) => row.id));
      });

      await AnalyticsCron.run(ctx);

      expect(merged).to.deep.equal([[1, 2, 3], [4]]);
      const jobsCalls = dbStub.withArgs('jobs').getCalls();
      expect(jobsCalls.map((c) => c.returnValue.limit.firstCall.args[0])).to.deep.equal([2, 1, 2]);
      // Each page continues from the last row of the page before it, across batches too
      expect(jobsCalls[1].returnValue.whereRaw.firstCall.args[1]).to.deep.equal(['2024-01-02 00:00:00+00', 2]);
      expect(jobsCalls[2].returnValue.whereRaw.firstCall.args[1]).to.deep.equal(['2024-01-03 00:00:00+00', 3]);
      expect(ctx.logger.info.calledWith('Analytics Cron Wrote a total of 4 rows to jobs')).to.be.true;
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
      // Since the batch failed, "Analytics Cron Wrote a total of ... rows to jobs" (logged
      // after the do/while loop completes normally) must never be reached for this table.
      // (anchored so it doesn't also match the log line for the jobs_raw_labels table)
      expect(ctx.logger.info.calledWithMatch(/^Analytics Cron Wrote a total of .* rows to jobs$/)).to.be.false;
    });

    describe('when the Postgres schema has changed', function () {
      beforeEach(function () {
        // Postgres jobs has a new requestChecksum column (and has dropped an old_column that
        // Iceberg still has)
        dbStub.withArgs('information_schema.columns').callsFake(() => makeColumnsQueryBuilder({
          jobs: [
            { column_name: 'id', data_type: 'integer' },
            { column_name: 'requestId', data_type: 'character' },
            { column_name: 'updatedAt', data_type: 'timestamp with time zone' },
            { column_name: 'requestChecksum', data_type: 'character varying' },
          ],
        }));
        duckDbConn.runAndReadAll.withArgs(sinon.match(/DESCRIBE catalog\.iceberg\.jobs/)).resolves({
          getRowObjectsJson: () => [
            { column_name: 'id', column_type: 'BIGINT' },
            { column_name: 'request_id', column_type: 'VARCHAR' },
            { column_name: 'updated_at', column_type: 'TIMESTAMP WITH TIME ZONE' },
            { column_name: 'old_column', column_type: 'VARCHAR' },
          ],
        });
        dbStub.withArgs('jobs').returns(makeQueryBuilder([
          { id: 1, requestId: 'req-1', updatedAt: new Date('2024-01-01T00:00:00Z'), requestChecksum: 'abc' },
        ]));
      });

      it('adds the new snake_cased column to Iceberg before merging rows', async function () {
        await AnalyticsCron.run(ctx);

        expect(duckDbConn.run.callCount).to.equal(2);
        expect(duckDbConn.run.firstCall.args[0])
          .to.equal('ALTER TABLE catalog.iceberg.jobs ADD COLUMN "request_checksum" VARCHAR;');
        expect(duckDbConn.run.secondCall.args[0]).to.match(/MERGE INTO catalog\.iceberg\.jobs/);
        expect(ctx.logger.info.calledWith('Added column request_checksum (VARCHAR) to Iceberg table jobs')).to.be.true;
      });

      it('adds the new column without a default when Postgres has no missing value for it', async function () {
        await AnalyticsCron.run(ctx);

        const queries = duckDbConn.run.getCalls().map((c) => c.args[0]);
        expect(queries.some((q: string) => /DEFAULT|^UPDATE/.test(q))).to.be.false;
      });

      it('reads the missing values of the table being synced', async function () {
        await AnalyticsCron.run(ctx);

        const missingValuesQuery = dbStub.withArgs('pg_attribute').firstCall.returnValue;
        expect(missingValuesQuery.whereRaw.calledWith('attrelid = ?::regclass', ['jobs'])).to.be.true;
        expect(missingValuesQuery.where.calledWith('atthasmissing', true)).to.be.true;
      });

      it('adds the new column with the value Postgres gave its existing rows as its default, without rewriting any rows', async function () {
        dbStub.withArgs('pg_attribute').returns(makeQueryBuilder([
          { attname: 'requestChecksum', missing_value: 'it\'s unknown' },
          { attname: 'id', missing_value: null },
        ]));

        await AnalyticsCron.run(ctx);

        expect(duckDbConn.run.callCount).to.equal(2);
        expect(duckDbConn.run.firstCall.args[0]).to.equal('ALTER TABLE catalog.iceberg.jobs ADD COLUMN '
          + '"request_checksum" VARCHAR DEFAULT CAST(\'it\'\'s unknown\' AS VARCHAR);');
        expect(duckDbConn.run.secondCall.args[0]).to.match(/MERGE INTO catalog\.iceberg\.jobs/);
        expect(ctx.logger.info.calledWith(
          'Added column request_checksum (VARCHAR, default it\'s unknown) to Iceberg table jobs')).to.be.true;
      });

      it('adds the new column without a default, and still merges rows, when the Iceberg table does not support the default', async function () {
        dbStub.withArgs('pg_attribute').returns(makeQueryBuilder([
          { attname: 'requestChecksum', missing_value: 'unknown' },
        ]));
        const defaultError = new Error('initial-default requires format version 3');
        duckDbConn.run.withArgs(sinon.match(/DEFAULT/)).rejects(defaultError);

        await AnalyticsCron.run(ctx);

        expect(ctx.logger.warn.calledWith(defaultError)).to.be.true;
        expect(duckDbConn.run.callCount).to.equal(3);
        expect(duckDbConn.run.secondCall.args[0])
          .to.equal('ALTER TABLE catalog.iceberg.jobs ADD COLUMN "request_checksum" VARCHAR;');
        expect(duckDbConn.run.thirdCall.args[0]).to.match(/MERGE INTO catalog\.iceberg\.jobs/);
      });

      it('skips the table without adding any columns when the missing values cannot be read', async function () {
        const pgError = new Error('pg_attribute read failed');
        dbStub.withArgs('pg_attribute').callsFake(() => makeQueryBuilder(pgError));

        await AnalyticsCron.run(ctx);

        expect(ctx.logger.error.calledWith(pgError)).to.be.true;
        expect(duckDbConn.run.called).to.be.false;
        expect(dbStub.withArgs('jobs').called).to.be.false;
      });

      it('only looks up the Postgres columns of the table being synced', async function () {
        await AnalyticsCron.run(ctx);

        const columnsQuery = dbStub.withArgs('information_schema.columns').getCalls()
          .find((c) => c.returnValue.where.calledWith('table_name', 'jobs'))!;
        expect(columnsQuery.returnValue.whereRaw.calledWith('table_schema = current_schema()')).to.be.true;
      });

      it('does not drop the Iceberg column that was removed from Postgres', async function () {
        await AnalyticsCron.run(ctx);

        const queries = duckDbConn.run.getCalls().map((c) => c.args[0]);
        expect(queries.some((q: string) => /DROP/i.test(q))).to.be.false;
      });

      it('merges only the columns Postgres has, leaving the removed column untouched', async function () {
        await AnalyticsCron.run(ctx);

        const mergeQuery = duckDbConn.run.secondCall.args[0];
        expect(mergeQuery).to.contain(
          'UPDATE SET "request_id" = upserts."request_id", "updated_at" = upserts."updated_at", '
          + '"request_checksum" = upserts."request_checksum"',
        );
        expect(mergeQuery).to.contain(
          'INSERT ("id", "request_id", "updated_at", "request_checksum") '
          + 'VALUES (upserts."id", upserts."request_id", upserts."updated_at", upserts."request_checksum")',
        );
        expect(mergeQuery).not.to.contain('old_column');
      });

      it('adds a column with an unmapped Postgres type as VARCHAR and logs a warning', async function () {
        dbStub.withArgs('information_schema.columns').callsFake(() => makeColumnsQueryBuilder({
          jobs: [{ column_name: 'tags', data_type: 'ARRAY' }],
        }));

        await AnalyticsCron.run(ctx);

        expect(duckDbConn.run.firstCall.args[0])
          .to.equal('ALTER TABLE catalog.iceberg.jobs ADD COLUMN "tags" VARCHAR;');
        expect(ctx.logger.warn.calledWithMatch(/No Iceberg type mapping for Postgres type ARRAY/)).to.be.true;
      });

      it('skips the table without merging when a column cannot be added, and still processes the remaining tables', async function () {
        const alterError = new Error('ALTER failed');
        duckDbConn.run.withArgs(sinon.match(/ALTER TABLE/)).rejects(alterError);

        await AnalyticsCron.run(ctx);

        expect(ctx.logger.error.calledWith(alterError)).to.be.true;
        expect(dbStub.withArgs('jobs').called).to.be.false;
        expect(duckDbConn.run.callCount).to.equal(1);
        expect(queriedDataTables(dbStub)).to.deep.equal(ALL_TABLES.filter((t) => t !== 'jobs'));
      });
    });

    it('does not touch the Iceberg schema when the Postgres columns cannot be read', async function () {
      await AnalyticsCron.run(ctx);

      expect(duckDbConn.runAndReadAll.calledWithMatch(/DESCRIBE/)).to.be.false;
      expect(ctx.logger.warn.calledWith('Could not read Postgres columns for jobs, skipping Iceberg schema update')).to.be.true;
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
      expect(queriedDataTables(dbStub)).to.deep.equal(ALL_TABLES);
      // updateAnalytics() never rejects (it catches and logs internally), so run() always
      // reaches its own completion log regardless of what happened while processing tables.
      expect(ctx.logger.info.calledWith('Completed analytics cron job')).to.be.true;
    });
  });
});
