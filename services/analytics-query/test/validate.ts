import { expect } from 'chai';
import { describe, it } from 'mocha';

import { hookFixtureDb } from './helpers/db';
import { caretOffset, MAX_SQL_LENGTH, validateSql, ValidationResult } from '../app/query/validate';

// Queries the validator must accept
const ACCEPTED = [
  'SELECT count(*) FROM catalog.iceberg.jobs',
  'SELECT count(*) FROM iceberg.jobs',
  'SELECT status, count(*) FROM jobs GROUP BY ALL',
  'FROM jobs LIMIT 5',
  'SELECT * FROM CATALOG.ICEBERG.jobs LIMIT 1',
  'SELECT STATUS, Job_ID FROM jobs LIMIT 1',
  'WITH failed AS (SELECT * FROM jobs WHERE status = \'failed\') SELECT count(*) FROM failed',
  'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3) SELECT * FROM n',
  'SELECT j.job_id, avg(w.duration) FROM jobs j JOIN work_items w USING (job_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 10',
  'SELECT * FROM jobs WHERE status = $status AND created_at >= $start',
  'SELECT * FROM jobs WHERE id IN (SELECT unnest($ids::BIGINT[]))',
  'SELECT date_trunc(\'day\', created_at) d, count(*) FROM jobs GROUP BY d -- @chart line x=d',
  'SELECT * FROM jobs PIVOT (count(*) FOR status IN (\'failed\', \'successful\') GROUP BY service_name)',
  'SELECT * FROM range(10)',
  'SELECT * FROM (SELECT id FROM jobs) t, LATERAL (SELECT t.id + 1 AS next)',
];

// Queries the validator must reject
const REJECTED = [
  'DELETE FROM jobs',
  'UPDATE jobs SET status = \'x\'',
  'INSERT INTO jobs (id) VALUES (1)',
  'DROP TABLE jobs',
  'CREATE TABLE x AS SELECT 1',
  'CREATE TEMP TABLE x AS SELECT 1',
  'CREATE TEMP MACRO m(x) AS x + 1',
  'COPY (SELECT * FROM jobs) TO \'/tmp/out.csv\'',
  'ATTACH \':memory:\' AS other',
  'DETACH catalog',
  'SET enable_external_access = true',
  'INSTALL httpfs',
  'LOAD httpfs',
  'PRAGMA version',
  'CALL duckdb_secrets()',
  'EXPLAIN SELECT 1',
  // DuckDB's simplified top-level PIVOT is its own statement type, not a SELECT
  'PIVOT jobs ON status USING count(*) GROUP BY service_name',
  'SELECT 1; DELETE FROM jobs',
  'SELECT 1; SELECT 2',
  'SELECT * FROM read_text(\'/etc/passwd\')',
  'SELECT * FROM \'/etc/passwd\'',
  'SELECT * FROM jobs WHERE id IN (SELECT 1 FROM read_csv(\'/etc/passwd\'))',
  'SELECT * FROM read_json(\'http://169.254.169.254/latest/meta-data/iam/\')',
  'SELECT * FROM query(\'SELECT * FROM read_text(\'\'/etc/passwd\'\')\')',
  'SELECT * FROM glob(\'/**\')',
  'SELECT * FROM duckdb_secrets()',
  'SELECT * FROM duckdb_settings()',
  'SELECT * FROM duckdb_settings',
  'SELECT * FROM information_schema.tables',
  'SELECT current_setting(\'s3_secret_access_key\')',
  'SELECT sleep_ms(100000)',
  'SELECT * FROM system.main.jobs',
  'SELECT * FROM other.iceberg.jobs',
  'SELECT * FROM catalog.jobs',
  'WITH jobs AS (SELECT * FROM read_text(\'/etc/passwd\')) SELECT * FROM jobs',
  'SELECT * FROM jobs, LATERAL (SELECT * FROM read_blob(\'/etc/hosts\'))',
  'SELECT * FROM iceberg_scan(\'s3://some-other-bucket/table\')',
  // The Iceberg catalog looks table names up case-sensitively
  'SELECT * FROM catalog.iceberg.JOBS LIMIT 1',
  'SELECT * FROM "CATALOG"."ICEBERG"."JOBS" LIMIT 1',
  // A parameter DuckDB can't infer a type for
  'SELECT * FROM jobs WHERE id IN (SELECT unnest($ids))',
  'SELECT nope FROM jobs',
  'SELECT * FRM jobs',
  '',
  '   ',
];

describe('validateSql', () => {
  const { db, tables } = hookFixtureDb();
  const validate = (sql: string): Promise<ValidationResult> =>
    db().withConnection((conn) => validateSql(conn, sql, tables()));

  for (const sql of ACCEPTED) {
    it(`accepts ${sql}`, async () => {
      const result = await validate(sql);
      expect(result.errors).to.eql([]);
      expect(result.valid).to.be.true;
      expect(result.columns.length).to.be.greaterThan(0);
    });
  }

  for (const sql of REJECTED) {
    it(`rejects ${JSON.stringify(sql)}`, async () => {
      const result = await validate(sql);
      expect(result.valid).to.be.false;
      expect(result.errors.length).to.be.greaterThan(0);
    });
  }

  it('rejects a query longer than the limit', async () => {
    const result = await validate(`SELECT 1 ${'-'.repeat(MAX_SQL_LENGTH)}`);
    expect(result.errors[0].message).to.include('longer than');
  });

  it('reports the output columns and the parameters with their inferred types', async () => {
    const result = await validate('SELECT id, created_at FROM jobs WHERE status = $status AND created_at >= $start');
    expect(result.columns).to.eql([
      { name: 'id', type: 'BIGINT' }, { name: 'created_at', type: 'TIMESTAMP WITH TIME ZONE' }]);
    expect(result.parameters).to.eql([
      { name: 'status', type: 'VARCHAR' }, { name: 'start', type: 'TIMESTAMP WITH TIME ZONE' }]);
  });

  for (const sql of ['DELETE FROM jobs', 'COPY (SELECT 1) TO \'/tmp/x\'', 'SET threads = 1', 'SELECT 1; DELETE FROM jobs']) {
    it(`explains that only SELECTs are allowed for ${sql}`, async () => {
      expect((await validate(sql)).errors).to.eql([{ message: 'Only SELECT queries are allowed', position: null }]);
    });
  }

  it('asks for an explicit type for a parameter DuckDB cannot infer', async () => {
    const result = await validate('SELECT * FROM jobs WHERE id IN (SELECT unnest($ids))');
    expect(result.errors[0].message).to.include('$ids::VARCHAR');
  });

  it('gives a hint for a mis-cased table name', async () => {
    const result = await validate('SELECT * FROM JOBS');
    expect(result.errors[0].message).to.equal('Table names are case-sensitive: use jobs');
  });

  describe('error positions', () => {
    const at = (sql: string, result: ValidationResult): string =>
      sql.slice(result.errors[0].position, result.errors[0].position + 8);

    it('points parser errors at the token', async () => {
      const sql = 'SELECT * FRM jobs';
      expect(at(sql, await validate(sql))).to.equal('jobs');
    });

    it('points binder errors at the column, on a later line', async () => {
      const sql = 'SELECT id,\n  nope\nFROM jobs';
      expect(at(sql, await validate(sql))).to.equal('nope\nFRO');
    });

    it('points policy errors at the function', async () => {
      const sql = 'SELECT * FROM jobs, read_text(\'/x\')';
      expect(at(sql, await validate(sql))).to.equal('read_tex');
    });

    it('drops the excerpt DuckDB appends to binder errors', async () => {
      const result = await validate('SELECT nope FROM jobs');
      expect(result.errors[0].message).not.to.include('LINE 1');
    });
  });
});

describe('caretOffset', () => {
  it('handles a truncated excerpt of a long line', () => {
    const sql = `SELECT ${'x, '.repeat(60)}nope FROM jobs`;
    const shown = sql.slice(sql.indexOf('nope') - 30, sql.indexOf('nope') + 20);
    const message = `Binder Error: x\n\nLINE 1: ...${shown}...\n${' '.repeat('LINE 1: ...'.length + 30)}^`;
    expect(caretOffset(sql, message)).to.equal(sql.indexOf('nope'));
  });

  it('returns null when there is no caret', () => {
    expect(caretOffset('SELECT 1', 'Catalog Error: nope')).to.be.null;
  });
});
