import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import {
  processWorkItems, WorkItemUpdateQueueItem,
} from '../../app/backends/workflow-orchestration/work-item-updates';
import { JobStatus } from '../../app/models/job';
import UserWork, { populateUserWorkForJobId } from '../../app/models/user-work';
import UserWorkHistory from '../../app/models/user-work-history';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import db from '../../app/util/db';
import { cancelAndSaveJob, pauseAndSaveJob, resumeAndSaveJob } from '../../app/util/job';
import logger from '../../app/util/log';
import { hookRedirect } from '../helpers/hooks';
import { rawSaveJob } from '../helpers/jobs';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import { rawSaveWorkItem } from '../helpers/work-items';
import { rawSaveWorkflowStep } from '../helpers/workflow-steps';

/**
 * Builds a work item update for a work item with the given status and duration
 *
 * @param workItemID - The id of the work item being updated
 * @param status - The work item's new status
 * @param duration - The duration reported by the service. This is much longer than the time the
 * test work items have been running, so it is the duration recorded.
 * @returns a work item update queue item ready to pass to processWorkItems
 */
function buildUpdate(workItemID: number, status: WorkItemStatus, duration: number): WorkItemUpdateQueueItem {
  const succeeded = status === WorkItemStatus.SUCCESSFUL;
  return {
    update: {
      workItemID,
      status,
      results: succeeded ? [`s3://fake-bucket/${workItemID}/catalog0.json`] : undefined,
      outputItemSizes: succeeded ? [100] : [],
      totalItemsSize: succeeded ? 0.0001 : 0,
      message: succeeded ? undefined : 'it broke',
      message_category: status === WorkItemStatus.FAILED ? 'noretry' : undefined,
      duration,
    },
    preprocessResult: {
      status,
      catalogItems: [],
      outputItemSizes: succeeded ? [100] : [],
    },
  };
}

describe('user_work duration tracking across work item updates, pauses, resumes, and cancellation', function () {
  const jobID = '22222222-2222-4222-8222-222222222222';
  const serviceID = 'svc1';
  const ids: number[] = [];

  /**
   * Gets the job's user_work row for the service
   * @returns the row, or undefined if there is none
   */
  async function getUserWork(): Promise<UserWork> {
    return db(UserWork.table).where({ job_id: jobID, service_id: serviceID }).first();
  }

  /**
   * Gets the job's user_work_history rows for the service
   * @returns the rows
   */
  async function getHistory(): Promise<UserWorkHistory[]> {
    return db(UserWorkHistory.table).where({ job_id: jobID, service_id: serviceID });
  }

  before(truncateAll);
  after(truncateAll);
  before(async function () {
    await rawSaveJob(db, {
      jobID, requestId: jobID, username: 'joe', status: JobStatus.RUNNING, isAsync: true,
      numInputGranules: 5, ignoreErrors: true, collectionIds: [], request: 'http://example.com',
      message: 'in progress', createdAt: new Date(), updatedAt: new Date(),
    });
    await rawSaveWorkflowStep(db, {
      jobID, serviceID, stepIndex: 1, workItemCount: 5, hasAggregatedOutput: false, isBatched: false,
    });
    const startedAt = new Date(Date.now() - 5000);
    for (let i = 0; i < 5; i++) {
      const workItem = await rawSaveWorkItem(db, {
        jobID, serviceID, workflowStepIndex: 1, status: WorkItemStatus.RUNNING, startedAt,
      });
      ids.push(workItem.id);
    }
    await populateUserWorkForJobId(db, jobID);
  });

  describe('when a work item succeeds and another fails', function () {
    before(async function () {
      await processWorkItems(jobID, 1, [buildUpdate(ids[0], WorkItemStatus.SUCCESSFUL, 600_000)], logger);
      await processWorkItems(jobID, 1, [buildUpdate(ids[1], WorkItemStatus.FAILED, 700_000)], logger);
    });

    it('only factors the successful work item into average_duration', async function () {
      expect(await getUserWork()).to.include({ average_duration: 600_000, completed_count: 1 });
    });

    it('tracks the failed work item separately', async function () {
      expect(await getUserWork()).to.include({ failed_count: 1, failed_sum_duration_ms: 700_000 });
    });
  });

  describe('when the job is paused', function () {
    before(async function () {
      await pauseAndSaveJob(jobID);
    });

    it('deletes the job\'s user_work rows', async function () {
      expect(await getUserWork()).to.be.undefined;
    });

    it('moves their totals to user_work_history', async function () {
      const history = await getHistory();
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({
        completed_count: 1, sum_duration_ms: 600_000, failed_count: 1, failed_sum_duration_ms: 700_000,
      });
    });
  });

  describe('when a work item that was already running completes while the job is paused', function () {
    before(async function () {
      await processWorkItems(jobID, 1, [buildUpdate(ids[2], WorkItemStatus.SUCCESSFUL, 300_000)], logger);
    });

    it('adds its duration to the existing user_work_history row', async function () {
      const history = await getHistory();
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({ completed_count: 2, sum_duration_ms: 900_000 });
    });
  });

  describe('when the job is resumed', function () {
    before(async function () {
      await resumeAndSaveJob(jobID, logger);
    });

    it('restores the totals to the job\'s new user_work row', async function () {
      expect(await getUserWork()).to.include({
        average_duration: 450_000, completed_count: 2, failed_count: 1, failed_sum_duration_ms: 700_000,
      });
    });
  });

  describe('when the job is paused and resumed repeatedly', function () {
    before(async function () {
      for (let i = 0; i < 3; i++) {
        await pauseAndSaveJob(jobID);
        await resumeAndSaveJob(jobID, logger);
      }
    });

    it('keeps exactly one user_work_history row with unchanged totals', async function () {
      const history = await getHistory();
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({ completed_count: 2, sum_duration_ms: 900_000, failed_count: 1 });
    });

    it('keeps the user_work totals unchanged', async function () {
      expect(await getUserWork()).to.include({ average_duration: 450_000, completed_count: 2, failed_count: 1 });
    });
  });

  describe('when a work item reports that it was canceled while the job is still running', function () {
    before(async function () {
      await processWorkItems(jobID, 1, [buildUpdate(ids[4], WorkItemStatus.CANCELED, 999_999)], logger);
    });

    it('marks the work item canceled', async function () {
      const workItem = await db('work_items').where({ id: ids[4] }).first();
      expect(workItem.status).to.equal(WorkItemStatus.CANCELED);
    });

    it('does not add its duration to the user_work totals', async function () {
      expect(await getUserWork()).to.include({
        average_duration: 450_000, completed_count: 2, failed_count: 1, failed_sum_duration_ms: 700_000,
      });
    });

    it('does not change the user_work_history totals', async function () {
      const history = await getHistory();
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({ completed_count: 2, sum_duration_ms: 900_000, failed_count: 1 });
    });
  });

  // Updates for a job that is already canceled are ignored by processWorkItems before they reach
  // the duration tracking, so this guards against that changing rather than testing the CANCELED
  // status handling itself (covered above)
  describe('when the job is canceled and its remaining work items report back afterwards', function () {
    before(async function () {
      await cancelAndSaveJob(jobID, logger);
      await processWorkItems(jobID, 1, [buildUpdate(ids[3], WorkItemStatus.SUCCESSFUL, 999_999)], logger);
      await processWorkItems(jobID, 1, [buildUpdate(ids[3], WorkItemStatus.CANCELED, 999_999)], logger);
    });

    it('deletes the job\'s user_work rows', async function () {
      expect(await getUserWork()).to.be.undefined;
    });

    it('does not add the canceled work items to the totals', async function () {
      const history = await getHistory();
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({
        completed_count: 2, sum_duration_ms: 900_000, failed_count: 1, failed_sum_duration_ms: 700_000,
      });
    });
  });
});

describe('when a user with recent history for a service submits a new request', function () {
  const queryCmr = 'harmonyservices/query-cmr:stable';
  hookServersStartStop();
  before(async function () {
    await truncateAll();
    const now = new Date();
    // two earlier jobs averaging (1000 + 5000) / 3 = 2000ms per query-cmr work item
    for (const [jobID, completedCount, sumDurationMs] of [
      ['33333333-3333-4333-8333-333333333331', 1, 1000], ['33333333-3333-4333-8333-333333333332', 2, 5000],
    ]) {
      await db(UserWorkHistory.table).insert({
        // requests in these tests are made as the anonymous user
        job_id: jobID, service_id: queryCmr, username: 'anonymous', is_async: true,
        completed_count: completedCount, sum_duration_ms: sumDurationMs, failed_count: 0,
        failed_sum_duration_ms: 0, first_worked_at: now, retired_at: now, createdAt: now, updatedAt: now,
      });
    }
  });
  after(truncateAll);

  hookRangesetRequest('1.0.0', 'C1260128044-EEDTEST', 'all', {
    query: { maxResults: 2, subset: 'lat(80:85)', format: 'application/netcdf' }, username: 'joe',
  });
  hookRedirect('joe');

  it('seeds the new job\'s average_duration from the user\'s history for that service', async function () {
    const { jobID } = JSON.parse(this.res.text);
    const row = await db(UserWork.table).where({ job_id: jobID, service_id: queryCmr }).first();
    expect(row).to.include({ average_duration: 2000, completed_count: 0 });
  });

  it('leaves average_duration unset for services the user has no history for', async function () {
    const { jobID } = JSON.parse(this.res.text);
    const rows = await db(UserWork.table).where({ job_id: jobID }).whereNot({ service_id: queryCmr });
    expect(rows.length).to.be.greaterThan(0);
    expect(rows.every((r) => r.average_duration === null)).to.be.true;
  });
});

describe('when a brand new user with no history for any service submits a new request', function () {
  hookServersStartStop();
  before(async function () {
    await truncateAll();
    // only another user has history, which must not be used to seed this user's job
    const now = new Date();
    await db(UserWorkHistory.table).insert({
      job_id: '44444444-4444-4444-8444-444444444441', service_id: 'harmonyservices/query-cmr:stable',
      username: 'someone-else', is_async: true, completed_count: 3, sum_duration_ms: 9000, failed_count: 0,
      failed_sum_duration_ms: 0, first_worked_at: now, retired_at: now, createdAt: now, updatedAt: now,
    });
  });
  after(truncateAll);

  hookRangesetRequest('1.0.0', 'C1260128044-EEDTEST', 'all', {
    query: { maxResults: 2, subset: 'lat(80:85)', format: 'application/netcdf' }, username: 'joe',
  });
  hookRedirect('joe');

  it('creates the job', async function () {
    const { jobID } = JSON.parse(this.res.text);
    expect(jobID).to.be.a('string');
  });

  it('leaves average_duration unset and completed_count at 0 for every service', async function () {
    const { jobID } = JSON.parse(this.res.text);
    const rows = await db(UserWork.table).where({ job_id: jobID });
    expect(rows.length).to.be.greaterThan(0);
    for (const row of rows) {
      expect(row.average_duration).to.be.null;
      expect(row.completed_count).to.equal(0);
    }
  });

  it('does not write anything to user_work_history for the new job', async function () {
    const { jobID } = JSON.parse(this.res.text);
    expect(await db(UserWorkHistory.table).where({ job_id: jobID })).to.be.empty;
  });
});
