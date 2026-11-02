import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import { JobStatus } from '../../app/models/job';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import {
  DURATION_BUCKET_COLUMNS, pruneWorkItemStats, toDate, upsertWorkItemStats,
} from '../../app/models/work-items-stats';
import db from '../../app/util/db';
import { rawSaveJob } from '../helpers/jobs';
import { rawSaveWorkItem } from '../helpers/work-items';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Sets the stats watermark so the next run aggregates everything from the given time on
 *
 * @param lastRunAt - the watermark time
 */
async function setWatermark(lastRunAt: Date): Promise<void> {
  const updated = await db('run_watermarks').where({ name: 'work_item_stats_update' }).update({ last_run_at: lastRunAt });
  if (updated === 0) {
    await db('run_watermarks').insert({ name: 'work_item_stats_update', last_run_at: lastRunAt });
  }
}

/**
 * Saves a job
 *
 * @param jobID - the job ID
 * @param fields - other job fields
 */
async function saveJob(jobID: string, fields: Record<string, unknown> = {}): Promise<void> {
  await rawSaveJob(db, {
    jobID, requestId: jobID, username: 'alice', status: JobStatus.RUNNING, isAsync: true,
    numInputGranules: 1, ignoreErrors: false, collectionIds: [], request: 'http://example.com',
    message: 'x', createdAt: new Date(), updatedAt: new Date(), ...fields,
  });
}

/**
 * Saves a work item
 *
 * @param fields - the work item fields
 */
async function saveWorkItem(fields: Record<string, unknown>): Promise<void> {
  await rawSaveWorkItem(db, { serviceID: 'svc:1', workflowStepIndex: 1, ...fields });
}

// the start of a minute safely in the past, so nothing falls in the current minute
const BASE = Math.floor((Date.now() - 3 * HOUR) / HOUR) * HOUR + 10 * MINUTE;
const at = (minutes: number, seconds = 0): Date => new Date(BASE + minutes * MINUTE + seconds * 1000);

describe('dashboard stats aggregation', function () {
  before(truncateAll);
  after(truncateAll);
  before(async function () {
    await saveJob('job-alice', { username: 'alice' });
    await saveJob('job-bob', { username: 'bob' });
    // durations land in the < 1s, 1-5s, 1-5min, and >= 1h buckets
    await saveWorkItem({ jobID: 'job-alice', status: WorkItemStatus.SUCCESSFUL, duration: 500, retryCount: 1, totalItemsSize: 2, updatedAt: at(0, 5) });
    await saveWorkItem({ jobID: 'job-alice', status: WorkItemStatus.SUCCESSFUL, duration: 3000, totalItemsSize: 3, updatedAt: at(0, 30) });
    await saveWorkItem({ jobID: 'job-bob', status: WorkItemStatus.FAILED, duration: 120_000, retryCount: 2, message_category: 'timeout', updatedAt: at(0, 40) });
    await saveWorkItem({ jobID: 'job-bob', status: WorkItemStatus.WARNING, duration: 2 * HOUR, message_category: 'no-data', updatedAt: at(1) });
    // excluded from durations: canceled, and a successful item without a duration
    await saveWorkItem({ jobID: 'job-bob', status: WorkItemStatus.CANCELED, duration: 999_999, updatedAt: at(1) });
    await saveWorkItem({ jobID: 'job-alice', status: WorkItemStatus.SUCCESSFUL, duration: -1, updatedAt: at(1) });
    // not terminal, so not counted at all
    await saveWorkItem({ jobID: 'job-alice', status: WorkItemStatus.RUNNING, duration: 100, updatedAt: at(1) });
    // a later hour
    await saveWorkItem({ jobID: 'job-alice', status: WorkItemStatus.SUCCESSFUL, duration: 4000, updatedAt: at(60) });
    // finished jobs (and one that hasn't finished)
    await saveJob('done-sync', { username: 'alice', status: JobStatus.SUCCESSFUL, isAsync: false, createdAt: at(-1), updatedAt: at(0, 20), numInputGranules: 3, original_data_size: 10, output_data_size: 4 });
    await saveJob('done-async', { username: 'alice', status: JobStatus.FAILED, isAsync: true, createdAt: at(-30), updatedAt: at(0, 50), numInputGranules: 7 });
    await saveJob('still-running', { username: 'alice', status: JobStatus.RUNNING, createdAt: at(-30), updatedAt: at(0, 50) });

    await setWatermark(at(-5));
    await upsertWorkItemStats(db);
  });

  describe('the per-minute service stats', function () {
    it('records durations, retries, and sizes, excluding canceled work items and missing durations', async function () {
      const successful = await db('work_items_stats').where({ service_id: 'svc:1', status: 'successful' }).orderBy('minute');
      expect(successful.map((r) => [r.count, r.duration_count, r.sum_duration_ms, r.max_duration_ms, r.retry_count, r.sum_items_size]))
        .to.eql([[2, 2, 3500, 3000, 1, 5], [1, 0, 0, 0, 0, 0], [1, 1, 4000, 4000, 0, 0]]);
      const [canceled] = await db('work_items_stats').where({ status: 'canceled' });
      expect([canceled.count, canceled.duration_count, canceled.sum_duration_ms]).to.eql([1, 0, 0]);
    });

    it('records each duration in its histogram bucket', async function () {
      const rows = await db('work_items_stats').where('minute', '<', at(2));
      const buckets = DURATION_BUCKET_COLUMNS.map((c) => rows.reduce((sum, r) => sum + Number(r[c]), 0));
      expect(buckets).to.eql([1, 1, 0, 0, 1, 0, 0, 1]);
    });

    it('does not count work items that have not finished', async function () {
      expect(await db('work_items_stats').where({ status: 'running' })).to.be.empty;
    });
  });

  describe('the per-minute user stats', function () {
    it('records each user\'s work items by service and status', async function () {
      const rows = await db('user_work_items_stats').where('minute', '<', at(2)).orderBy(['username', 'status', 'minute']);
      expect(rows.map((r) => [r.username, r.status, Number(r.count), Number(r.sum_duration_ms)])).to.eql([
        ['alice', 'successful', 2, 3500],
        ['alice', 'successful', 1, 0],
        ['bob', 'canceled', 1, 0],
        ['bob', 'failed', 1, 120_000],
        ['bob', 'warning', 1, 2 * HOUR],
      ]);
    });
  });

  describe('the per-minute failure stats', function () {
    it('counts failed and warning work items by message category', async function () {
      const rows = await db('work_items_failure_stats').orderBy('status');
      expect(rows.map((r) => [r.status, r.message_category, Number(r.count)])).to.eql([
        ['failed', 'timeout', 1], ['warning', 'no-data', 1],
      ]);
    });
  });

  describe('the per-minute job stats', function () {
    it('records finished jobs by user, mode, and status with their durations', async function () {
      const rows = await db('job_stats').orderBy('status');
      expect(rows.map((r) => [r.username, Boolean(r.is_async), r.status, Number(r.count), Number(r.sum_duration_ms),
        Number(r.sum_granules), Number(r.sum_input_size), Number(r.sum_output_size)])).to.eql([
        ['alice', true, 'failed', 1, 30 * MINUTE + 50_000, 7, 0, 0],
        ['alice', false, 'successful', 1, MINUTE + 20_000, 3, 10, 4],
      ]);
    });
  });

  describe('the hourly rollups', function () {
    it('combine the per-minute rows of each hour', async function () {
      const rows = await db('work_items_stats_hourly').where({ status: 'successful' }).orderBy('hour');
      expect(rows.map((r) => [toDate(r.hour).getTime(), Number(r.count), Number(r.sum_duration_ms), Number(r.max_duration_ms)]))
        .to.eql([[BASE - 10 * MINUTE, 3, 3500, 3000], [BASE - 10 * MINUTE + HOUR, 1, 4000, 4000]]);
    });

    it('exist for every table family', async function () {
      for (const table of ['user_work_items_stats_hourly', 'work_items_failure_stats_hourly', 'job_stats_hourly']) {
        expect(await db(table)).to.not.be.empty;
      }
    });
  });

  describe('when the same minutes are aggregated again', function () {
    before(async function () {
      await setWatermark(at(-5));
      await upsertWorkItemStats(db);
    });

    it('does not count anything twice', async function () {
      const [{ total }] = await db('work_items_stats').sum({ total: 'count' });
      expect(Number(total)).to.equal(7);
      const [{ hourlyTotal }] = await db('work_items_stats_hourly').sum({ hourlyTotal: 'count' });
      expect(Number(hourlyTotal)).to.equal(7);
    });
  });
});

describe('dashboard stats aggregation when a work item moves to a later minute', function () {
  before(truncateAll);
  after(truncateAll);

  it('removes it from the minute it used to be counted in', async function () {
    await saveJob('job-1');
    await saveWorkItem({ jobID: 'job-1', status: WorkItemStatus.SUCCESSFUL, duration: 100, updatedAt: at(0) });
    await setWatermark(at(-5));
    await upsertWorkItemStats(db);
    await db('work_items').update({ updatedAt: at(3) });
    await setWatermark(at(-5));
    await upsertWorkItemStats(db);

    const rows = await db('work_items_stats');
    expect(rows.map((r) => [toDate(r.minute).getTime(), Number(r.count)])).to.eql([[at(3).getTime(), 1]]);
  });
});

describe('pruneWorkItemStats', function () {
  const now = Date.now();
  const daysAgo = (days: number): Date => new Date(Math.floor((now - days * 24 * HOUR) / HOUR) * HOUR);
  const statsRow = (time: Date, timeColumn: string): Record<string, unknown> => ({ [timeColumn]: time, service_id: 'svc', status: 'successful', count: 1 });

  beforeEach(async function () {
    await truncateAll();
    // three hours of expired per-minute rows, and a recent one
    for (const hours of [0, 1, 2]) {
      await db('work_items_stats').insert(statsRow(new Date(daysAgo(20).getTime() + hours * HOUR), 'minute'));
    }
    await db('work_items_stats').insert(statsRow(daysAgo(1), 'minute'));
    // an expired hourly row, and one that is old but within the hourly retention
    await db('work_items_stats_hourly').insert(statsRow(daysAgo(500), 'hour'));
    await db('work_items_stats_hourly').insert(statsRow(daysAgo(20), 'hour'));
  });
  after(truncateAll);

  it('deletes per-minute and hourly rows past their retention periods', async function () {
    const deleted = await pruneWorkItemStats(db, 14, 400, 10);
    expect(deleted.work_items_stats).to.equal(3);
    expect(deleted.work_items_stats_hourly).to.equal(1);
    expect(await db('work_items_stats')).to.have.length(1);
    expect(await db('work_items_stats_hourly')).to.have.length(1);
  });

  it('deletes at most the given number of hours of rows from each table per run', async function () {
    const deleted = await pruneWorkItemStats(db, 14, 400, 2);
    expect(deleted.work_items_stats).to.equal(2);
    expect(await db('work_items_stats')).to.have.length(2);
  });
});
