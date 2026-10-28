import { expect } from 'chai';
import { subDays } from 'date-fns';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import { JobStatus, terminalStates } from '../../app/models/job';
import UserWork, {
  decrementRunningCount, deleteUserWorkForJob, deleteUserWorkForJobAndService,
  getCompletedWorkItemDuration, populateUserWorkForJobId, restoreOrSeedUserWorkDurations,
} from '../../app/models/user-work';
import UserWorkHistory, {
  addCompletionToUserWorkHistory, deleteUserWorkHistoryByIds, getExpiredUserWorkHistoryIds,
  getSeedAverageDurations, MAX_SEED_JOBS, moveUserWorkRowsToHistory,
} from '../../app/models/user-work-history';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import db from '../../app/util/db';
import { rawSaveJob } from '../helpers/jobs';
import { createUserWorkRecord } from '../helpers/user-work';
import { rawSaveWorkflowStep } from '../helpers/workflow-steps';

/**
 * Gets the user_work row for a job and service
 *
 * @param jobID - The job ID
 * @param serviceID - The service ID
 * @returns the row, or undefined if there is none
 */
async function getUserWork(jobID: string, serviceID: string): Promise<UserWork> {
  return db(UserWork.table).where({ job_id: jobID, service_id: serviceID }).first();
}

/**
 * Gets the user_work_history rows for a job and service
 *
 * @param jobID - The job ID
 * @param serviceID - The service ID
 * @returns the rows
 */
async function getHistory(jobID: string, serviceID: string): Promise<UserWorkHistory[]> {
  return db(UserWorkHistory.table).where({ job_id: jobID, service_id: serviceID });
}

/**
 * Inserts a user_work_history row
 *
 * @param fields - The fields to set, with defaults for the rest
 * @returns a promise that resolves once the row is inserted
 */
async function insertHistory(fields: Partial<UserWorkHistory>): Promise<void> {
  const now = new Date();
  await db(UserWorkHistory.table).insert({
    job_id: 'job', service_id: 'svc', username: 'joe', is_async: true, completed_count: 0,
    sum_duration_ms: 0, failed_count: 0, failed_sum_duration_ms: 0, first_worked_at: now,
    retired_at: now, createdAt: now, updatedAt: now, ...fields,
  });
}

describe('getCompletedWorkItemDuration', function () {
  it('records successful work items as completed', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.SUCCESSFUL, 100)).to.eql({ durationMs: 100, failed: false });
  });

  it('records warning work items as completed', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.WARNING, 100)).to.eql({ durationMs: 100, failed: false });
  });

  it('records failed work items as failed', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.FAILED, 100)).to.eql({ durationMs: 100, failed: true });
  });

  it('does not record canceled work items', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.CANCELED, 100)).to.be.undefined;
  });

  it('does not record work items that have not finished', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.RUNNING, 100)).to.be.undefined;
    expect(getCompletedWorkItemDuration(WorkItemStatus.READY, 100)).to.be.undefined;
  });

  it('does not record a missing duration', function () {
    expect(getCompletedWorkItemDuration(WorkItemStatus.SUCCESSFUL, NaN)).to.be.undefined;
    expect(getCompletedWorkItemDuration(WorkItemStatus.SUCCESSFUL, undefined)).to.be.undefined;
  });
});

describe('decrementRunningCount with a failed work item', function () {
  before(async function () {
    await createUserWorkRecord({
      job_id: 'failJob', service_id: 'svc', running_count: 2, average_duration: 1000, completed_count: 2,
    }).save(db);
    await decrementRunningCount(db, 'failJob', 'svc', { durationMs: 50, failed: true });
    await decrementRunningCount(db, 'failJob', 'svc', { durationMs: 70, failed: true });
  });
  after(truncateAll);

  it('leaves average_duration and completed_count unchanged', async function () {
    const row = await getUserWork('failJob', 'svc');
    expect(row.average_duration).to.equal(1000);
    expect(row.completed_count).to.equal(2);
  });

  it('counts the failures and sums their durations', async function () {
    const row = await getUserWork('failJob', 'svc');
    expect(row.failed_count).to.equal(2);
    expect(row.failed_sum_duration_ms).to.equal(120);
  });

  it('returns 0 when the job and service has no user_work row', async function () {
    const numUpdated = await decrementRunningCount(db, 'missingJob', 'svc', { durationMs: 50, failed: false });
    expect(numUpdated).to.equal(0);
  });
});

describe('deleting user_work rows', function () {
  describe('for a job and service', function () {
    let numDeleted: number;
    before(async function () {
      await createUserWorkRecord({
        job_id: 'delJob', service_id: 'svc1', username: 'sue', is_async: true,
        average_duration: 1500, completed_count: 4,
      }).save(db);
      await db(UserWork.table).where({ job_id: 'delJob', service_id: 'svc1' })
        .update({ failed_count: 1, failed_sum_duration_ms: 300 });
      await createUserWorkRecord({ job_id: 'delJob', service_id: 'svc2', average_duration: 10, completed_count: 1 })
        .save(db);
      numDeleted = await deleteUserWorkForJobAndService(db, 'delJob', 'svc1');
    });
    after(truncateAll);

    it('returns the number of rows deleted', function () {
      expect(numDeleted).to.equal(1);
    });

    it('deletes only that row', async function () {
      expect(await getUserWork('delJob', 'svc1')).to.be.undefined;
      expect(await getUserWork('delJob', 'svc2')).to.not.be.undefined;
    });

    it('moves the row\'s totals to user_work_history', async function () {
      const history = await getHistory('delJob', 'svc1');
      expect(history.length).to.equal(1);
      expect(history[0]).to.include({
        username: 'sue', completed_count: 4, sum_duration_ms: 6000, failed_count: 1, failed_sum_duration_ms: 300,
      });
      expect(Boolean(history[0].is_async)).to.be.true;
      expect(history[0].first_worked_at).to.not.be.null;
    });

    it('does not move the other service\'s row', async function () {
      expect(await getHistory('delJob', 'svc2')).to.be.empty;
    });
  });

  describe('for a whole job, when some rows have no completed or failed work items', function () {
    before(async function () {
      await createUserWorkRecord({ job_id: 'delJob2', service_id: 'svc1', average_duration: 20, completed_count: 2 })
        .save(db);
      // e.g. a later step that never ran, or one whose average_duration was only seeded
      await createUserWorkRecord({ job_id: 'delJob2', service_id: 'svc2', average_duration: 999_999 }).save(db);
      await deleteUserWorkForJob(db, 'delJob2');
    });
    after(truncateAll);

    it('deletes every row for the job', async function () {
      expect(await db(UserWork.table).where({ job_id: 'delJob2' })).to.be.empty;
    });

    it('only moves rows with measured work items to user_work_history', async function () {
      expect((await getHistory('delJob2', 'svc1')).length).to.equal(1);
      expect(await getHistory('delJob2', 'svc2')).to.be.empty;
    });
  });
});

describe('moveUserWorkRowsToHistory when the job and service already has a history row', function () {
  const deletedRow = {
    job_id: 'moveJob', service_id: 'svc', username: 'joe', is_async: false, average_duration: 100,
    completed_count: 0, failed_count: 0, failed_sum_duration_ms: 0, createdAt: new Date(),
  };

  beforeEach(async function () {
    await insertHistory({ job_id: 'moveJob', completed_count: 10, sum_duration_ms: 1000, failed_count: 2 });
  });
  afterEach(truncateAll);

  it('replaces the totals with ones that include at least as many work items', async function () {
    await moveUserWorkRowsToHistory(db, [{ ...deletedRow, completed_count: 11, failed_count: 2, failed_sum_duration_ms: 5 }]);
    const history = await getHistory('moveJob', 'svc');
    expect(history.length).to.equal(1);
    expect(history[0]).to.include({ completed_count: 11, sum_duration_ms: 1100, failed_count: 2, failed_sum_duration_ms: 5 });
  });

  it('does not replace the totals with ones that include fewer work items', async function () {
    await moveUserWorkRowsToHistory(db, [{ ...deletedRow, completed_count: 3 }]);
    const history = await getHistory('moveJob', 'svc');
    expect(history.length).to.equal(1);
    expect(history[0]).to.include({ completed_count: 10, sum_duration_ms: 1000, failed_count: 2 });
  });
});

describe('addCompletionToUserWorkHistory', function () {
  afterEach(truncateAll);

  it('creates the history row if there is none', async function () {
    await addCompletionToUserWorkHistory(db, 'addJob', 'svc', 'joe', true, { durationMs: 250, failed: false });
    const history = await getHistory('addJob', 'svc');
    expect(history.length).to.equal(1);
    expect(history[0]).to.include({ username: 'joe', completed_count: 1, sum_duration_ms: 250, failed_count: 0 });
  });

  it('adds successful work items to the existing totals', async function () {
    await insertHistory({ job_id: 'addJob', completed_count: 10, sum_duration_ms: 1000 });
    await addCompletionToUserWorkHistory(db, 'addJob', 'svc', 'joe', true, { durationMs: 250, failed: false });
    const history = await getHistory('addJob', 'svc');
    expect(history.length).to.equal(1);
    expect(history[0]).to.include({ completed_count: 11, sum_duration_ms: 1250, failed_count: 0 });
  });

  it('adds failed work items to the failed totals only', async function () {
    await insertHistory({ job_id: 'addJob', completed_count: 10, sum_duration_ms: 1000 });
    await addCompletionToUserWorkHistory(db, 'addJob', 'svc', 'joe', true, { durationMs: 40, failed: true });
    const history = await getHistory('addJob', 'svc');
    expect(history[0]).to.include({
      completed_count: 10, sum_duration_ms: 1000, failed_count: 1, failed_sum_duration_ms: 40,
    });
  });
});

describe('when a job and service\'s first completion happens while the job is paused', function () {
  const firstWorkedAt = new Date(Date.now() - 60_000);
  before(async function () {
    // no history row yet, so this creates one without knowing when the job was first worked
    await addCompletionToUserWorkHistory(db, 'firstJob', 'svc', 'joe', true, { durationMs: 100, failed: false });
    // the job is resumed (restoring the totals), then deleted again
    await moveUserWorkRowsToHistory(db, [{
      job_id: 'firstJob', service_id: 'svc', username: 'joe', is_async: true, average_duration: 150,
      completed_count: 2, failed_count: 0, failed_sum_duration_ms: 0, createdAt: firstWorkedAt,
    }]);
  });
  after(truncateAll);

  it('fills in first_worked_at once it is known', async function () {
    const [history] = await getHistory('firstJob', 'svc');
    expect(new Date(history.first_worked_at).getTime()).to.equal(firstWorkedAt.getTime());
    expect(history).to.include({ completed_count: 2, sum_duration_ms: 300 });
  });
});

describe('getSeedAverageDurations', function () {
  before(async function () {
    // weighted by completed work items: (1000 + 5000) / (1 + 2) = 2000
    await insertHistory({ job_id: 'seed1', username: 'ann', service_id: 'svc', completed_count: 1, sum_duration_ms: 1000 });
    await insertHistory({ job_id: 'seed2', username: 'ann', service_id: 'svc', completed_count: 2, sum_duration_ms: 5000 });
    // only failures, so excluded
    await insertHistory({ job_id: 'seed3', username: 'ann', service_id: 'svc', failed_count: 3, failed_sum_duration_ms: 1 });
    // too old, so excluded
    await insertHistory({
      job_id: 'seed4', username: 'ann', service_id: 'svc', completed_count: 1, sum_duration_ms: 1_000_000,
      retired_at: subDays(new Date(), 10),
    });
    // another user and another service, so excluded
    await insertHistory({ job_id: 'seed5', username: 'bob', service_id: 'svc', completed_count: 1, sum_duration_ms: 7 });
    await insertHistory({ job_id: 'seed6', username: 'ann', service_id: 'other', completed_count: 1, sum_duration_ms: 9 });
  });
  after(truncateAll);

  it('returns the average duration of the user\'s recent work items for each service', async function () {
    const seeds = await getSeedAverageDurations(db, 'ann', ['svc', 'other', 'none'], 7);
    expect(seeds).to.eql({ svc: 2000, other: 9 });
  });

  it('includes older history with a longer lookback', async function () {
    const seeds = await getSeedAverageDurations(db, 'ann', ['svc'], 30);
    expect(seeds).to.eql({ svc: Math.round(1_006_000 / 4) });
  });

  it('returns nothing when seeding is disabled', async function () {
    expect(await getSeedAverageDurations(db, 'ann', ['svc'], 0)).to.eql({});
  });
});

describe('getSeedAverageDurations for a user with more than MAX_SEED_JOBS recent jobs', function () {
  before(async function () {
    const now = Date.now();
    // the most recent MAX_SEED_JOBS jobs average 100ms, older ones 10,000ms
    for (let i = 0; i < MAX_SEED_JOBS + 20; i++) {
      await insertHistory({
        job_id: `many${i}`, username: 'busy', completed_count: 1,
        sum_duration_ms: i < MAX_SEED_JOBS ? 100 : 10_000, retired_at: new Date(now - i * 1000),
      });
    }
  });
  after(truncateAll);

  it('only averages the most recent jobs', async function () {
    expect(await getSeedAverageDurations(db, 'busy', ['svc'], 7)).to.eql({ svc: 100 });
  });
});

describe('restoreOrSeedUserWorkDurations', function () {
  before(async function () {
    await createUserWorkRecord({ job_id: 'resJob', service_id: 'measured', username: 'ann' }).save(db);
    await createUserWorkRecord({ job_id: 'resJob', service_id: 'onlyFailed', username: 'ann' }).save(db);
    await createUserWorkRecord({ job_id: 'resJob', service_id: 'unmeasured', username: 'ann' }).save(db);
    await createUserWorkRecord({ job_id: 'resJob', service_id: 'noHistory', username: 'ann' }).save(db);
    // this job's own history
    await insertHistory({
      job_id: 'resJob', username: 'ann', service_id: 'measured', completed_count: 4, sum_duration_ms: 400,
      failed_count: 1, failed_sum_duration_ms: 9,
    });
    await insertHistory({
      job_id: 'resJob', username: 'ann', service_id: 'onlyFailed', failed_count: 2, failed_sum_duration_ms: 8,
    });
    // the user's other jobs, used for seeding
    await insertHistory({ job_id: 'other1', username: 'ann', service_id: 'measured', completed_count: 1, sum_duration_ms: 99_999 });
    await insertHistory({ job_id: 'other2', username: 'ann', service_id: 'onlyFailed', completed_count: 1, sum_duration_ms: 3000 });
    await insertHistory({ job_id: 'other3', username: 'ann', service_id: 'unmeasured', completed_count: 1, sum_duration_ms: 5000 });
    await restoreOrSeedUserWorkDurations(db, 'resJob', 7);
  });
  after(truncateAll);

  it('restores the job\'s own measured totals rather than seeding them', async function () {
    const row = await getUserWork('resJob', 'measured');
    expect(row).to.include({ average_duration: 100, completed_count: 4, failed_count: 1, failed_sum_duration_ms: 9 });
  });

  it('restores the failed totals and seeds average_duration when the job has no successes', async function () {
    const row = await getUserWork('resJob', 'onlyFailed');
    expect(row).to.include({ average_duration: 3000, completed_count: 0, failed_count: 2, failed_sum_duration_ms: 8 });
  });

  it('seeds average_duration without a completed_count when the job has no history', async function () {
    const row = await getUserWork('resJob', 'unmeasured');
    expect(row).to.include({ average_duration: 5000, completed_count: 0, failed_count: 0 });
  });

  it('leaves average_duration unset when there is nothing to restore or seed from', async function () {
    const row = await getUserWork('resJob', 'noHistory');
    expect(row.average_duration).to.be.null;
    expect(row.completed_count).to.equal(0);
  });
});

describe('a seeded average_duration', function () {
  before(async function () {
    await createUserWorkRecord({ job_id: 'seededJob', service_id: 'svc', running_count: 1, average_duration: 50_000 })
      .save(db);
    await decrementRunningCount(db, 'seededJob', 'svc', { durationMs: 200, failed: false });
  });
  after(truncateAll);

  it('is replaced (not averaged in) by the first measured duration', async function () {
    const row = await getUserWork('seededJob', 'svc');
    expect(row).to.include({ average_duration: 200, completed_count: 1 });
  });
});

describe('repeatedly pausing and resuming a job', function () {
  const jobID = '00000000-0000-4000-8000-000000000001';

  before(async function () {
    await rawSaveJob(db, {
      jobID, requestId: jobID, username: 'joe', status: JobStatus.RUNNING, isAsync: true, numInputGranules: 10,
      ignoreErrors: false, collectionIds: [], request: 'http://example.com', message: 'in progress',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await rawSaveWorkflowStep(db, { jobID, serviceID: 'svc', stepIndex: 1, workItemCount: 10 });
    await populateUserWorkForJobId(db, jobID);

    // 10 completions averaging 1000ms, then three pause/resume cycles each with one more
    // completion of 2100ms, 2200ms, and 1200ms
    await db(UserWork.table).where({ job_id: jobID }).update({ average_duration: 1000, completed_count: 10 });
    for (const durationMs of [2100, 2200, 1200]) {
      await deleteUserWorkForJob(db, jobID); // pause
      await populateUserWorkForJobId(db, jobID); // resume
      await decrementRunningCount(db, jobID, 'svc', { durationMs, failed: false });
    }
    await deleteUserWorkForJob(db, jobID); // final pause
  });
  after(truncateAll);

  it('keeps exactly one user_work_history row for the job and service', async function () {
    expect((await getHistory(jobID, 'svc')).length).to.equal(1);
  });

  it('records the full totals without counting any cycle twice', async function () {
    const [history] = await getHistory(jobID, 'svc');
    // 10,000 + 2,100 = 12,100 over 11 (1,100 avg), + 2,200 = 14,300 over 12 (~1,192 avg),
    // + 1,200 = 15,500 over 13 - allowing for average_duration being rounded to the ms after each
    // completion. Counting a cycle twice would add thousands.
    expect(history.completed_count).to.equal(13);
    expect(history.sum_duration_ms).to.be.within(15_480, 15_520);
  });

  it('restores the totals to the user_work row on the next resume', async function () {
    await populateUserWorkForJobId(db, jobID);
    const row = await getUserWork(jobID, 'svc');
    expect(row.completed_count).to.equal(13);
    expect(row.average_duration).to.be.within(1192, 1193);
  });
});

describe('getExpiredUserWorkHistoryIds', function () {
  const old = subDays(new Date(), 60);
  const finishedJob = '00000000-0000-4000-8000-000000000011';
  const pausedJob = '00000000-0000-4000-8000-000000000012';
  const recentFinishedJob = '00000000-0000-4000-8000-000000000013';
  const deletedJob = '00000000-0000-4000-8000-000000000014';
  let ids: number[];

  before(async function () {
    for (const [jobID, status] of [
      [finishedJob, JobStatus.SUCCESSFUL], [pausedJob, JobStatus.PAUSED], [recentFinishedJob, JobStatus.CANCELED],
    ]) {
      await rawSaveJob(db, {
        jobID, requestId: jobID, username: 'joe', status: status as JobStatus, isAsync: true,
        numInputGranules: 1, ignoreErrors: false, collectionIds: [], request: 'http://example.com',
        message: 'x', createdAt: new Date(), updatedAt: new Date(),
      });
    }
    await insertHistory({ job_id: finishedJob, retired_at: old, completed_count: 1 });
    await insertHistory({ job_id: pausedJob, retired_at: old, completed_count: 1 });
    await insertHistory({ job_id: recentFinishedJob, completed_count: 1 });
    await insertHistory({ job_id: deletedJob, retired_at: old, completed_count: 1 });
    ids = await getExpiredUserWorkHistoryIds(db, subDays(new Date(), 30), terminalStates, 0, 100);
  });
  after(truncateAll);

  it('returns old rows for finished jobs and jobs that no longer exist', async function () {
    const jobIDs = (await db(UserWorkHistory.table).whereIn('id', ids)).map((r) => r.job_id).sort();
    expect(jobIDs).to.eql([finishedJob, deletedJob].sort());
  });

  it('deletes the rows by id', async function () {
    expect(await deleteUserWorkHistoryByIds(db, ids)).to.equal(2);
    const remaining = (await db(UserWorkHistory.table)).map((r) => r.job_id).sort();
    expect(remaining).to.eql([pausedJob, recentFinishedJob].sort());
  });
});
