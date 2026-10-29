/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import { rawSaveJob } from './helpers/jobs';
import { createUserWorkRecord } from './helpers/user-work';
import { rawSaveWorkItem } from './helpers/work-items';
import { truncateAll } from '../../../packages/util/test/helpers/db';
import {
  clearDashboardCache, CURRENT_DASHBOARD_API_VERSION, getDashboardJobsByWorkItemStatus, getDashboardRunningJobs,
  getDashboardServiceDetails, getDashboardSummary, getDashboardUserDetails, getDashboardUsers,
} from '../app/frontends/dashboard-api';
import { JobStatus } from '../app/models/job';
import { WorkItemStatus } from '../app/models/work-item-interface';
import { upsertWorkItemStats } from '../app/models/work-items-stats';
import db from '../app/util/db';
import env from '../app/util/env';
import { RequestValidationError } from '../app/util/errors';
import { WorkItemQueueType } from '../app/util/queue/queue';
import * as qf from '../app/util/queue/queue-factory';
import * as serviceImages from '../app/util/service-images';

const MINUTE = 60_000;
const ECR_SUBSETTER = '123456789012.dkr.ecr.us-west-2.amazonaws.com/nasa/subsetter:1.0';

/**
 * Calls a dashboard API handler
 *
 * @param handler - the handler
 * @param query - the query parameters
 * @param params - the path parameters
 * @returns the JSON response, or the error passed to next
 */
async function call(
  handler: (req: any, res: any, next: any) => Promise<void>, query: Record<string, string> = {},
  params: Record<string, string> = {},
): Promise<{ body?: any, error?: any }> {
  const res = { json: sinon.stub() };
  const next = sinon.stub();
  await handler({ query, params, context: { logger: { info: sinon.stub() } } }, res, next);
  return next.called ? { error: next.firstCall.args[0] } : { body: res.json.firstCall.args[0] };
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

describe('dashboard API', function () {
  const sandbox = sinon.createSandbox();
  const recently = (minutesAgo: number): Date => new Date(Date.now() - minutesAgo * MINUTE);

  before(async function () {
    await truncateAll();
    // keyed by image without its tag or registry host, as getServiceName looks them up
    sandbox.stub(serviceImages, 'getImageToServiceMap').returns({
      'nasa/subsetter': 'subsetter',
      'nasa/reformatter': 'reformatter',
    });
    sandbox.stub(qf.getWorkSchedulerQueue(), 'getApproximateNumberOfMessages').resolves(1);
    sandbox.stub(qf.getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE), 'getApproximateNumberOfMessages').resolves(2);
    sandbox.stub(qf.getQueueForType(WorkItemQueueType.LARGE_ITEM_UPDATE), 'getApproximateNumberOfMessages').rejects(new Error('no queue'));

    await saveJob('alice-job', { username: 'alice' });
    await saveJob('bob-job', { username: 'bob' });
    const item = (jobID: string, serviceID: string, status: WorkItemStatus, duration: number, minutesAgo: number, retryCount = 0): Promise<unknown> =>
      rawSaveWorkItem(db, { jobID, serviceID, status, duration, retryCount, workflowStepIndex: 1, updatedAt: recently(minutesAgo), message_category: status === WorkItemStatus.FAILED ? 'timeout' : undefined });
    // two image versions of the subsetter, one from ECR
    await item('alice-job', ECR_SUBSETTER, WorkItemStatus.SUCCESSFUL, 2000, 30);
    await item('alice-job', 'ghcr.io/nasa/subsetter:1.1', WorkItemStatus.SUCCESSFUL, 4000, 20, 2);
    await item('bob-job', 'ghcr.io/nasa/subsetter:1.1', WorkItemStatus.FAILED, 600, 10, 3);
    await item('bob-job', 'ghcr.io/nasa/reformatter:2', WorkItemStatus.SUCCESSFUL, 1000, 10);
    // the previous 24 hours, for comparison
    await item('alice-job', ECR_SUBSETTER, WorkItemStatus.SUCCESSFUL, 1000, 25 * 60);
    // finished jobs
    await saveJob('sync-done', { username: 'alice', status: JobStatus.SUCCESSFUL, isAsync: false, createdAt: recently(41), updatedAt: recently(40) });
    await saveJob('async-done', { username: 'bob', status: JobStatus.FAILED, isAsync: true, createdAt: recently(100), updatedAt: recently(40) });
    // a long running job that hasn't been updated in two hours
    await saveJob('stuck-job', { username: 'carol', status: JobStatus.RUNNING, createdAt: recently(300), updatedAt: recently(120) });

    // live work
    await createUserWorkRecord({ job_id: 'alice-job', service_id: 'ghcr.io/nasa/subsetter:1.1', username: 'alice', ready_count: 5, running_count: 2, last_worked: recently(15) }).save(db);
    await createUserWorkRecord({ job_id: 'carol-job', service_id: 'ghcr.io/nasa/reformatter:2', username: 'carol', ready_count: 1, last_worked: recently(5) }).save(db);

    await db('run_watermarks').insert({ name: 'work_item_stats_update', last_run_at: recently(2 * 24 * 60) });
    await upsertWorkItemStats(db);
    clearDashboardCache();
  });

  after(async function () {
    sandbox.restore();
    clearDashboardCache();
    await truncateAll();
  });

  describe('summary', function () {
    let body: any;
    before(async function () {
      ({ body } = await call(getDashboardSummary));
    });

    it('defaults to the last 24 hours of per-minute stats, compared with the 24 hours before', function () {
      expect(new Date(body.range.end).getTime() - new Date(body.range.start).getTime()).to.equal(24 * 60 * MINUTE);
      expect(body.range.granularity).to.equal('minute');
      expect(body.previousRange.end).to.equal(body.range.start);
    });

    it('totals the work items in the range', function () {
      expect(body.totals.counts).to.eql({ successful: 3, failed: 1, canceled: 0, warning: 0 });
      expect(body.totals.successRate).to.equal(0.75);
      expect(body.totals.avgDurationMs).to.equal(Math.round((2000 + 4000 + 600 + 1000) / 4));
      expect(body.totals.maxDurationMs).to.equal(4000);
      expect(body.totals.p95DurationMs).to.be.a('number');
      expect(body.previousTotals.total).to.equal(1);
    });

    it('counts all retries, and separately the retries of work items that went on to succeed', function () {
      expect(body.totals.retries).to.equal(5);
      expect(body.totals.successfulRetries).to.equal(2);
      // 3 successful work items took 3 + 2 attempts
      expect(body.totals.successfulRetryRate).to.equal(2 / 5);
      expect(body.previousTotals.successfulRetries).to.equal(0);
    });

    it('has no retry rate without successful work items', async function () {
      const { body: details } = await call(getDashboardUserDetails, {}, { name: 'carol' });
      expect(details.totals.successfulRetryRate).to.be.null;
    });

    it('has a time series covering the range', function () {
      expect(body.series).to.have.length(96);
      expect(body.series.reduce((sum: number, p: any) => sum + p.successful + p.failed, 0)).to.equal(4);
    });

    it('has the duration histogram', function () {
      expect(body.histogram.map((b: any) => b.count)).to.eql([1, 3, 0, 0, 0, 0, 0, 0]);
    });

    it('combines the stats of every image of a service', function () {
      const subsetter = body.services.find((s: any) => s.name === 'subsetter');
      expect(subsetter.total).to.equal(3);
      expect(subsetter.counts.failed).to.equal(1);
      expect(subsetter.previousTotal).to.equal(1);
      expect(subsetter.live).to.include({ ready: 5, running: 2 });
      expect(subsetter.live.oldestReadyWaitMs).to.be.within(15 * MINUTE - 5000, 15 * MINUTE + 60_000);
      expect(subsetter.spark).to.have.length(24);
      expect(subsetter.spark.reduce((a: number, b: number) => a + b, 0)).to.equal(3);
    });

    it('estimates the compute time of the backlog, with the default for unmeasured work', function () {
      // none of the live work has a measured duration: 5 + 1 ready work items at the default
      expect(body.live).to.include({
        backlogComputeEstimateMs: 6 * body.defaultBacklogEstimateMs, backlogDefaultEstimateCount: 6,
      });
      const subsetter = body.services.find((s: any) => s.name === 'subsetter');
      expect(subsetter.live.backlogComputeEstimateMs).to.equal(5 * body.defaultBacklogEstimateMs);
    });

    it('estimates the time to clear each backlog from its own recent throughput', function () {
      // completed in the throughput window (15 minutes, ending a minute before the current one):
      // subsetter 4000 + 600 ms (20 and 10 minutes ago - only the latter) and reformatter 1000 ms
      const window = body.throughputWindowMs;
      const subsetter = body.services.find((s: any) => s.name === 'subsetter');
      expect(subsetter.live.recentComputeRate).to.equal(600 / window);
      expect(subsetter.live.backlogClearEstimateMs).to.equal(Math.round((5 * body.defaultBacklogEstimateMs) / (600 / window)));
      const reformatter = body.services.find((s: any) => s.name === 'reformatter');
      expect(reformatter.live.backlogClearEstimateMs).to.equal(Math.round(body.defaultBacklogEstimateMs / (1000 / window)));
      expect(body.live.recentComputeRate).to.equal(1600 / window);
    });

    it('lists the services with the most queued work first', function () {
      expect(body.services.map((s: any) => s.name)).to.eql(['subsetter', 'reformatter']);
    });

    it('includes live work, finished jobs, queue sizes, and stats freshness', function () {
      expect(body.live).to.include({ ready: 6, running: 2 });
      expect(body.jobs.total).to.equal(2);
      expect(body.jobs.sync).to.include({ count: 1, avgDurationMs: MINUTE });
      expect(body.jobs.counts.failed).to.equal(1);
      expect(body.queues).to.eql({ smallWorkItemUpdates: 2, largeWorkItemUpdates: -1, workItemScheduler: 1 });
      expect(body.statsAgeMs).to.be.a('number');
    });

    it('reads the hourly rollups for longer ranges', async function () {
      const { body: weekly } = await call(getDashboardSummary, { range: '7d' });
      expect(weekly.range.granularity).to.equal('hour');
      expect(weekly.totals.total).to.equal(5);
    });
  });

  describe('service details', function () {
    let body: any;
    before(async function () {
      ({ body } = await call(getDashboardServiceDetails, {}, { name: 'subsetter' }));
    });

    it('totals only that service\'s work items', function () {
      expect(body.totals.total).to.equal(3);
      expect(body.live).to.include({ ready: 5, running: 2 });
    });

    it('breaks the stats down by image, without exposing the registry (e.g. the ECR account)', function () {
      expect(body.images.map((i: any) => [i.image, i.total]).sort()).to.eql([
        ['nasa/subsetter:1.0', 1], ['nasa/subsetter:1.1', 2],
      ]);
    });

    it('lists failures by message category', function () {
      expect(body.failureCategories).to.eql([{ status: 'failed', messageCategory: 'timeout', count: 1 }]);
    });

    it('lists the service\'s users by compute time', function () {
      expect(body.users.map((u: any) => [u.username, u.computeMs, u.live.ready])).to.eql([
        ['alice', 6000, 5], ['bob', 600, 0],
      ]);
    });

    it('returns empty stats for a service with no work', async function () {
      const { body: empty } = await call(getDashboardServiceDetails, {}, { name: 'nothing' });
      expect(empty.totals.total).to.equal(0);
      expect(empty.users).to.eql([]);
    });
  });

  describe('users', function () {
    it('ranks users by compute time, with their jobs and live work', async function () {
      const { body } = await call(getDashboardUsers);
      expect(body.users.map((u: any) => [u.username, u.computeMs, u.jobs.total, u.live.ready])).to.eql([
        ['alice', 6000, 1, 5], ['bob', 1600, 1, 0], ['carol', 0, 0, 1],
      ]);
      expect(body.totalUsers).to.equal(3);
    });

    it('limits the number of users returned', async function () {
      const { body } = await call(getDashboardUsers, { limit: '1' });
      expect(body.users).to.have.length(1);
      expect(body.totalUsers).to.equal(3);
    });

    it('rejects an invalid limit', async function () {
      const { error } = await call(getDashboardUsers, { limit: '0' });
      expect(error).to.be.instanceOf(RequestValidationError);
    });

    it('filters the users by part of their username, ignoring case, before limiting them', async function () {
      const { body } = await call(getDashboardUsers, { filter: 'O', limit: '1' });
      expect(body.users.map((u: any) => u.username)).to.eql(['bob']);
      expect(body.totalUsers).to.equal(2);
    });

    it('only includes the users of a service, with only their work for it', async function () {
      const { body } = await call(getDashboardUsers, { service: 'subsetter' });
      expect(body.users.map((u: any) => [u.username, u.computeMs, u.live.ready])).to.eql([
        ['alice', 6000, 5], ['bob', 600, 0],
      ]);
      expect(body.service).to.equal('subsetter');
    });

    it('includes users with only live work for a service, but not users with only finished jobs', async function () {
      const { body } = await call(getDashboardUsers, { service: 'reformatter' });
      expect(body.users.map((u: any) => [u.username, u.computeMs, u.live.ready])).to.eql([
        ['bob', 1000, 0], ['carol', 0, 1],
      ]);
    });

    it('returns no users for a service with no work', async function () {
      const { body } = await call(getDashboardUsers, { service: 'nothing' });
      expect(body.users).to.eql([]);
      expect(body.totalUsers).to.equal(0);
    });

    it('sorts every user before limiting them, so the sort picks the users returned', async function () {
      const { body } = await call(getDashboardUsers, { sort: 'failed', limit: '1' });
      expect(body.users.map((u: any) => u.username)).to.eql(['bob']);
      expect(body.sort).to.eql({ key: 'failed', dir: 'desc' });
      const { body: ascending } = await call(getDashboardUsers, { sort: 'username', dir: 'asc' });
      expect(ascending.users.map((u: any) => u.username)).to.eql(['alice', 'bob', 'carol']);
    });

    it('sorts by the estimated compute time of the backlog', async function () {
      const { body } = await call(getDashboardUsers, { sort: 'backlogCompute' });
      expect(body.users.map((u: any) => u.username)).to.eql(['alice', 'carol', 'bob']);
    });

    it('can\'t estimate the time to clear a backlog without recent throughput', async function () {
      const { body } = await call(getDashboardUsers);
      const byName = Object.fromEntries(body.users.map((u: any) => [u.username, u.live]));
      // alice completed nothing in the throughput window, so her backlog can't be estimated
      expect(byName.alice).to.include({ recentComputeRate: 0, backlogClearEstimateMs: null });
      // bob has no backlog
      expect(byName.bob.backlogClearEstimateMs).to.equal(0);
      // and an unestimatable backlog sorts as the longest
      const { body: sorted } = await call(getDashboardUsers, { sort: 'backlogClear' });
      expect(sorted.users[0].username).to.be.oneOf(['alice', 'carol']);
    });

    it('estimates a user\'s time to clear their backlog for a service from their throughput for it', async function () {
      const { body } = await call(getDashboardServiceDetails, {}, { name: 'reformatter' });
      const carol = body.users.find((u: any) => u.username === 'carol');
      // carol completed nothing, even though bob completed reformatter work
      expect(carol.live.backlogClearEstimateMs).to.be.null;
      expect(body.live.recentComputeRate).to.equal(1000 / (15 * MINUTE));
    });

    it('defaults to sorting by compute time, descending', async function () {
      const { body } = await call(getDashboardUsers);
      expect(body.sort).to.eql({ key: 'computeMs', dir: 'desc' });
    });

    it('rejects an invalid sort', async function () {
      for (const query of [{ sort: 'constructor' }, { sort: 'total', dir: 'sideways' }]) {
        const { error } = await call(getDashboardUsers, query);
        expect(error).to.be.instanceOf(RequestValidationError);
      }
    });

    it('returns no users when none match the filter', async function () {
      const { body } = await call(getDashboardUsers, { filter: 'dave' });
      expect(body.users).to.eql([]);
      expect(body.totalUsers).to.equal(0);
    });
  });

  describe('jobs by work item status', function () {
    it('lists the jobs with work items that reached the status, with the most first', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful' });
      expect(body.jobs.map((j: any) => [j.jobID, j.username, j.jobStatus, j.workItemCount])).to.eql([
        ['alice-job', 'alice', 'running', 2], ['bob-job', 'bob', 'running', 1],
      ]);
      expect(body.hasMore).to.be.false;
    });

    it('links to the job\'s work items with that status in the workflow UI', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'failed' });
      expect(body.jobs.map((j: any) => j.jobID)).to.eql(['bob-job']);
      const link = decodeURIComponent(body.jobs[0].link);
      expect(link).to.match(/^\/admin\/workflow-ui\/bob-job\?tableFilter=/);
      expect(link).to.include('"dbValue":"failed"');
    });

    it('only includes the work items of every image of a service', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', service: 'subsetter' });
      expect(body.jobs.map((j: any) => [j.jobID, j.workItemCount])).to.eql([['alice-job', 2]]);
      const { body: none } = await call(getDashboardJobsByWorkItemStatus, { status: 'failed', service: 'reformatter' });
      expect(none.jobs).to.eql([]);
    });

    it('only includes a user\'s jobs', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', user: 'bob' });
      expect(body.jobs.map((j: any) => j.jobID)).to.eql(['bob-job']);
    });

    it('only includes work items that reached the status in the range', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', range: '1h', service: 'subsetter' });
      expect(body.jobs.map((j: any) => j.workItemCount)).to.eql([2]);
      const { body: previous } = await call(getDashboardJobsByWorkItemStatus, {
        status: 'successful', start: recently(26 * 60).toISOString(), end: recently(24 * 60).toISOString(),
      });
      expect(previous.jobs.map((j: any) => [j.jobID, j.workItemCount])).to.eql([['alice-job', 1]]);
    });

    it('only warns that work items may have been deleted when the range starts before the work reaper cutoff', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', range: '7d' });
      expect(body.workItemsReapedBefore).to.be.null;

      const { body: older } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', range: '30d' });
      const reapedBefore = new Date(older.workItemsReapedBefore).getTime();
      const expected = Date.now() - env.reapableWorkAgeMinutes * 60_000;
      expect(Math.abs(reapedBefore - expected)).to.be.lessThan(60_000);
    });

    it('says when there are more jobs than the limit', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'successful', limit: '1' });
      expect(body.jobs).to.have.length(1);
      expect(body.hasMore).to.be.true;
    });

    it('requires a valid status', async function () {
      for (const query of [{}, { status: 'running' }]) {
        const { error } = await call(getDashboardJobsByWorkItemStatus, query);
        expect(error).to.be.instanceOf(RequestValidationError);
      }
    });

    it('is versioned', async function () {
      const { body } = await call(getDashboardJobsByWorkItemStatus, { status: 'failed' });
      expect(body.version).to.equal(CURRENT_DASHBOARD_API_VERSION);
      const { error } = await call(getDashboardJobsByWorkItemStatus, { status: 'failed', version: '2' });
      expect(error).to.be.instanceOf(RequestValidationError);
    });
  });

  describe('user details', function () {
    it('breaks the user\'s work down by service, with their jobs and a link to them', async function () {
      const { body } = await call(getDashboardUserDetails, {}, { name: 'bob' });
      expect(body.services.map((s: any) => [s.name, s.total]).sort()).to.eql([['reformatter', 1], ['subsetter', 1]]);
      expect(body.jobs.async.count).to.equal(1);
      expect(body.series.reduce((sum: number, p: any) => sum + p.successful + p.failed, 0)).to.equal(2);
      expect(decodeURIComponent(body.jobsLink)).to.include('user: bob');
    });
  });

  describe('running jobs', function () {
    it('lists the oldest running jobs and counts the stalled ones', async function () {
      const { body } = await call(getDashboardRunningJobs);
      expect(body.jobs[0].jobID).to.equal('stuck-job');
      expect(body.runningCount).to.equal(3);
      expect(body.stalledCount).to.equal(1);
    });
  });

  describe('range validation', function () {
    it('rejects an unknown preset', async function () {
      const { error } = await call(getDashboardSummary, { range: '3h' });
      expect(error).to.be.instanceOf(RequestValidationError);
    });

    it('rejects a range given both as a preset and start/end', async function () {
      const { error } = await call(getDashboardSummary, { range: '1h', start: '2026-01-01T00:00:00Z' });
      expect(error).to.be.instanceOf(RequestValidationError);
    });

    it('rejects an invalid timestamp', async function () {
      const { error } = await call(getDashboardSummary, { start: 'yesterday' });
      expect(error).to.be.instanceOf(RequestValidationError);
    });

    it('accepts a custom range', async function () {
      const { body } = await call(getDashboardSummary, {
        start: recently(60).toISOString(), end: recently(0).toISOString(),
      });
      expect(body.totals.total).to.equal(4);
    });
  });

  describe('versioning', function () {
    const endpoints: [string, (req: any, res: any, next: any) => Promise<void>, Record<string, string>][] = [
      ['summary', getDashboardSummary, {}],
      ['service details', getDashboardServiceDetails, { name: 'subsetter' }],
      ['users', getDashboardUsers, {}],
      ['user details', getDashboardUserDetails, { name: 'alice' }],
      ['running jobs', getDashboardRunningJobs, {}],
    ];

    for (const [name, handler, params] of endpoints) {
      describe(`for ${name}`, function () {
        it('responds with the current version when no version is requested', async function () {
          const { body } = await call(handler, {}, params);
          expect(body.version).to.equal(CURRENT_DASHBOARD_API_VERSION);
        });

        it('accepts version 1', async function () {
          const { body, error } = await call(handler, { version: '1' }, params);
          expect(error).to.be.undefined;
          expect(body.version).to.equal('1');
        });

        it('rejects an unsupported version', async function () {
          const { error } = await call(handler, { version: '2' }, params);
          expect(error).to.be.instanceOf(RequestValidationError);
          expect(error.message).to.equal('Invalid API version. Supported versions are: 1');
        });
      });
    }

    it('accepts the version parameter in any case', async function () {
      const { body } = await call(getDashboardUsers, { Version: '1' });
      expect(body.version).to.equal('1');
    });

    it('returns the same data whether or not the version is given', async function () {
      const { body: unversioned } = await call(getDashboardUsers, { range: '1h' });
      const { body: versioned } = await call(getDashboardUsers, { range: '1h', version: '1' });
      expect({ ...versioned, generatedAt: undefined }).to.eql({ ...unversioned, generatedAt: undefined });
    });
  });

  describe('caching', function () {
    let originalTtl: number;
    before(function () {
      originalTtl = env.dashboardCacheTtlMs;
      env.dashboardCacheTtlMs = 60_000;
      clearDashboardCache();
    });
    after(function () {
      env.dashboardCacheTtlMs = originalTtl;
      clearDashboardCache();
    });

    it('serves repeated requests from the cache until it is cleared', async function () {
      const { body: first } = await call(getDashboardUsers, { range: '1h' });
      await db('user_work').update({ ready_count: 100 });
      const { body: cached } = await call(getDashboardUsers, { range: '1h' });
      expect(cached).to.eql(first);
      clearDashboardCache();
      const { body: fresh } = await call(getDashboardUsers, { range: '1h' });
      expect(fresh.users.find((u: any) => u.username === 'alice').live.ready).to.equal(100);
    });
  });
});
