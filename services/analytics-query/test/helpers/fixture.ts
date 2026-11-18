import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DuckDBInstance } from '@duckdb/node-api';

// A DuckDB file shaped like the Iceberg catalog (an `iceberg` schema), attached READ_ONLY as the
// catalog in tests. Unique per process so parallel test runs don't share it.
export const FIXTURE_DIR = join(tmpdir(), `analytics-query-test-${process.pid}`);
export const FIXTURE_PATH = join(FIXTURE_DIR, 'fixture.duckdb');

export const JOB_COUNT = 5000;
export const WORK_ITEM_COUNT = 50000;

/**
 * Create the fixture database
 */
export async function buildFixture(): Promise<void> {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const instance = await DuckDBInstance.create(FIXTURE_PATH);
  const conn = await instance.connect();
  try {
    await conn.run(`
      CREATE SCHEMA iceberg;
      CREATE TABLE iceberg.jobs AS SELECT range AS id, 'job-' || range AS job_id, 'user' || (range % 7) AS username,
        ['successful', 'failed', 'running'][1 + range % 3] AS status, 'svc-' || (range % 4) AS service_name,
        TIMESTAMPTZ '2026-10-01 00:00:00+00' + to_minutes(range::BIGINT) AS created_at,
        TIMESTAMPTZ '2026-10-01 00:05:00+00' + to_minutes(range::BIGINT) AS updated_at FROM range(${JOB_COUNT});
      CREATE TABLE iceberg.work_items AS SELECT range AS id, 'job-' || (range % ${JOB_COUNT}) AS job_id,
        ['successful', 'failed'][1 + range % 2] AS status, (range % 300)::DOUBLE AS duration,
        TIMESTAMPTZ '2026-10-01 00:00:00+00' + to_seconds(range::BIGINT) AS updated_at FROM range(${WORK_ITEM_COUNT});
      -- A table whose timestamps were stored as strings, as ministack used to create them
      CREATE TABLE iceberg.job_links AS SELECT range AS id, 'job-' || range AS job_id,
        '2026-10-01 00:00:00+00' AS updated_at FROM range(10);`);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/**
 * Delete the fixture database
 */
export function removeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
}
