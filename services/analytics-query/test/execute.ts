import { expect } from 'chai';
import { describe, it } from 'mocha';

import { hookFixtureDb } from './helpers/db';
import { JOB_COUNT } from './helpers/fixture';
import { executeQuery, ParameterValue, QueryLimits, QueryResult } from '../app/query/execute';
import { QueryTimeoutError, RequestValidationError } from '../app/util/errors';

const LIMITS: QueryLimits = { maxRows: 1000, timeoutMs: 10_000 };

describe('executeQuery', () => {
  const { db } = hookFixtureDb();
  const run = (sql: string, params: Record<string, ParameterValue> = {}, limits = LIMITS): Promise<QueryResult> =>
    db().withConnection((conn) => executeQuery(conn, sql, params, limits));
  const count = async (sql: string, params: Record<string, ParameterValue>): Promise<unknown> =>
    (await run(sql, params)).rows[0][0];

  describe('parameters', () => {
    it('binds strings, numbers, booleans and lists, cast to the inferred types', async () => {
      const n = await count(`SELECT count(*) FROM jobs WHERE created_at >= $start AND id >= $min_id
        AND id IN (SELECT unnest($ids::BIGINT[])) AND $flag AND status IN (SELECT unnest($statuses::VARCHAR[]))`,
      { start: '2026-10-01T00:02:00Z', min_id: 1, ids: [1, 2, 3, 4], flag: true, statuses: ['successful', 'failed', 'running'] });
      // Job n is created n minutes after midnight, so of ids 1-4 only 2, 3 and 4 are at or after 00:02
      expect(n).to.equal(3);
    });

    it('treats a value containing SQL as a literal', async () => {
      const sql = 'SELECT count(*) FROM jobs WHERE status = $status';
      expect(await count(sql, { status: "failed' OR '1'='1" })).to.equal(0);
      expect(await count(sql, { status: 'failed' })).to.be.greaterThan(0);
    });

    it('binds null', async () => {
      expect(await count('SELECT count(*) FROM jobs WHERE $status::VARCHAR IS NULL', { status: null })).to.equal(JOB_COUNT);
    });

    it('rejects a missing parameter', async () => {
      await expect(run('SELECT * FROM jobs WHERE id = $id')).to.be.rejectedWith(RequestValidationError)
        .and.eventually.have.nested.property('errors[0].message', 'No value was given for parameter $id');
    });

    it('rejects a parameter the query does not have', async () => {
      await expect(run('SELECT 1', { nope: 1 })).to.be.rejectedWith(RequestValidationError)
        .and.eventually.have.nested.property('errors[0].message', 'The query has no parameter $nope');
    });

    it('rejects a fractional number for an integer parameter instead of rounding it', async () => {
      await expect(run('SELECT * FROM jobs WHERE id = $id', { id: 1.5 })).to.be.rejectedWith(RequestValidationError)
        .and.eventually.have.nested.property('errors[0].message').that.include('whole number');
    });

    it('rejects an integer too large to be exact as a number, but binds it given as a string', async () => {
      await expect(run('SELECT $id::BIGINT', { id: 2 ** 60 })).to.be.rejectedWith(RequestValidationError)
        .and.eventually.have.nested.property('errors[0].message').that.include('give it as a string');
      await expect(run('SELECT unnest($ids::BIGINT[])', { ids: [1, 2 ** 60] })).to.be.rejectedWith(RequestValidationError);
      const big = String(2n ** 60n + 1n);
      expect((await run('SELECT $id::BIGINT', { id: big })).rows[0][0]).to.equal(big);
      // As the page sends a list with one such value: every element as text
      const rows = (await run('SELECT unnest($ids::BIGINT[]) AS id', { ids: ['1', big] })).rows.map((r) => r[0]);
      expect(rows).to.eql([1, big]);
    });

    it('rejects a list for a scalar parameter', async () => {
      await expect(run('SELECT * FROM jobs WHERE id = $id', { id: [1] })).to.be.rejectedWith(RequestValidationError);
    });

    it('rejects a list with mixed element types', async () => {
      await expect(run('SELECT unnest($xs::VARCHAR[])', { xs: ['a', 1] })).to.be.rejectedWith(RequestValidationError);
    });

    it('rejects an object value', async () => {
      await expect(run('SELECT $x::VARCHAR', { x: { a: 1 } as unknown as ParameterValue }))
        .to.be.rejectedWith(RequestValidationError);
    });

    it('reports a value DuckDB cannot convert as a validation error', async () => {
      await expect(run('SELECT count(*) FROM jobs WHERE created_at >= $start', { start: 'not a date' }))
        .to.be.rejectedWith(RequestValidationError, /invalid timestamp/);
    });
  });

  describe('limits', () => {
    it('stops at the row cap without reading the whole result, and says it was truncated', async () => {
      const startMs = Date.now();
      const result = await run('SELECT range AS i, md5(range::VARCHAR) AS h FROM range(200000000)', {},
        { maxRows: 100, timeoutMs: 10_000 });
      expect(result.rowCount).to.equal(100);
      expect(result.rows.length).to.equal(100);
      expect(result.truncated).to.be.true;
      expect(Date.now() - startMs).to.be.lessThan(2000);
    });

    it('does not flag a result at the cap as truncated', async () => {
      const result = await run('SELECT * FROM range(100)', {}, { maxRows: 100, timeoutMs: 10_000 });
      expect(result.truncated).to.be.false;
      expect(result.rowCount).to.equal(100);
    });

    it('interrupts a query that runs past the time limit', async () => {
      const startMs = Date.now();
      await expect(run('SELECT count(*) FROM range(200000) a, range(200000) b WHERE (a.range * b.range) % 7 = 3',
        {}, { maxRows: 10, timeoutMs: 300 })).to.be.rejectedWith(QueryTimeoutError);
      expect(Date.now() - startMs).to.be.lessThan(3000);
    });
  });

  describe('values', () => {
    it('returns TIMESTAMPTZ values as ISO UTC strings, keeping microseconds', async () => {
      const result = await run(`SELECT TIMESTAMPTZ '2026-11-18 12:34:56.789123+00' AS a,
        TIMESTAMPTZ '2026-11-18 12:34:56+00' AS b, TIMESTAMPTZ '1969-12-31 23:59:59.999+00' AS c, NULL::TIMESTAMPTZ AS d`);
      expect(result.rows[0]).to.eql(['2026-11-18T12:34:56.789123Z', '2026-11-18T12:34:56.000Z', '1969-12-31T23:59:59.999Z', null]);
    });

    it('returns integers and decimals that fit as numbers, and ones that do not as strings', async () => {
      // 2^100 is too big for a JS number. (Computed rather than written out, since a long run of
      // digits looks like an AWS account id to git-secrets.)
      const result = await run('SELECT 42::BIGINT, 1::HUGEINT << 100, 1.25::DECIMAL(10, 2), sum(id) FROM jobs');
      expect(result.rows[0]).to.eql([42, String(2n ** 100n), 1.25, (JOB_COUNT * (JOB_COUNT - 1)) / 2]);
    });

    it('returns a decimal a number would round as a string', async () => {
      // 2^60 + 0.25, computed as above rather than written out
      const result = await run(`SELECT ((1::HUGEINT << 60)::DECIMAL(38, 2) + 0.25)::DECIMAL(38, 2),
        0.1::DECIMAL(10, 4), -2.50::DECIMAL(5, 2)`);
      expect(result.rows[0]).to.eql([`${2n ** 60n}.25`, 0.1, -2.5]);
    });

    it('returns TIMESTAMPTZ values past the JS Date range with an extended year', async () => {
      const result = await run(`SELECT TIMESTAMPTZ '290000-01-02 03:04:05.000006+00' AS a,
        TIMESTAMPTZ '2026-11-18 12:34:56+00' AS b`);
      expect(result.rows[0]).to.eql(['+290000-01-02T03:04:05.000006Z', '2026-11-18T12:34:56.000Z']);
    });

    it('keeps columns whose names repeat', async () => {
      const result = await run('SELECT 1 AS id, 2 AS id');
      expect(result.columns.map((c) => c.name)).to.eql(['id', 'id']);
      expect(result.rows[0]).to.eql([1, 2]);
    });

    it('reports each column type', async () => {
      const result = await run('SELECT id, status, created_at FROM jobs LIMIT 1');
      expect(result.columns).to.eql([
        { name: 'id', type: 'BIGINT' }, { name: 'status', type: 'VARCHAR' }, { name: 'created_at', type: 'TIMESTAMP WITH TIME ZONE' }]);
    });
  });
});
