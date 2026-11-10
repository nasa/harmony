import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import { adaptiveFastLanePolicy } from '../../app/backends/workflow-orchestration/adaptive-fast-lane-policy';
import {
  durationBasedPolicy, FairQueueingPolicy, getFairQueueingPolicy, slotBasedPolicy,
} from '../../app/backends/workflow-orchestration/fair-queueing-policy';
import { getWorkItemsFromDatabase } from '../../app/backends/workflow-orchestration/work-item-polling';
import { JobRecord } from '../../app/models/job';
import UserWork from '../../app/models/user-work';
import { WorkItemRecord } from '../../app/models/work-item-interface';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { makePartialJobRecord, rawSaveJob } from '../helpers/jobs';
import { populateUserWorkFromWorkItems } from '../helpers/user-work';
import { makePartialWorkItemRecord, rawSaveWorkItem } from '../helpers/work-items';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from '../helpers/workflow-steps';

// a 10 pod service with the work-scheduler's default fast lane settings
const context = { servicePodCount: 10, slowWorkThresholdMs: 600000, fastLaneReserveFraction: 0.3 };

interface TestJob {
  jobID: string;
  username: string;
  isAsync?: boolean;
  running: number;
  ready: number;
  // the job's average work item duration for the service, or undefined if it has none yet
  averageDuration?: number;
}

/**
 * Saves the jobs, each with a workflow step for the 'foo' service and the given running and
 * ready work items, and populates user_work from them.
 *
 * @param jobs - the jobs to save
 */
async function saveJobs(jobs: TestJob[]): Promise<void> {
  for (const [index, job] of jobs.entries()) {
    const updatedAt = 40000 + index;
    await rawSaveJob(db, makePartialJobRecord(
      [job.jobID, job.username, 'running', job.isAsync ?? true, updatedAt]) as Partial<JobRecord>);
    await rawSaveWorkflowStep(db, makePartialWorkflowStepRecord([job.jobID, 'foo', '[]']));
    const items = [
      ...Array.from({ length: job.running }, () => [job.jobID, 'foo', 'running', updatedAt]),
      ...Array.from({ length: job.ready }, () => [job.jobID, 'foo', 'ready', updatedAt]),
    ];
    for (const item of items) {
      await rawSaveWorkItem(db, makePartialWorkItemRecord(item) as WorkItemRecord);
    }
  }
  await populateUserWorkFromWorkItems(db);
  for (const job of jobs.filter((j) => j.averageDuration !== undefined)) {
    await db(UserWork.table).where({ job_id: job.jobID })
      .update({ average_duration: job.averageDuration, completed_count: 1 });
  }
}

/**
 * Asks the policy for a batch of work items for the 'foo' service and counts them by job.
 *
 * @param batchSize - the batch size
 * @param policy - the fair queueing policy
 * @returns the number of work items taken from each job
 */
async function takeBatch(batchSize: number, policy: FairQueueingPolicy = adaptiveFastLanePolicy): Promise<Record<string, number>> {
  const workItems = await getWorkItemsFromDatabase('foo', logger, batchSize, policy, context);
  const counts: Record<string, number> = {};
  for (const { workItem } of workItems) counts[workItem.jobID] = (counts[workItem.jobID] ?? 0) + 1;
  return counts;
}

/**
 * Sets environment variables for the tests in the enclosing describe, restoring them afterwards.
 *
 * @param vars - the variables to set
 */
function hookEnv(vars: Record<string, string>): void {
  const original: Record<string, string | undefined> = {};
  before(function () {
    for (const [key, value] of Object.entries(vars)) {
      original[key] = process.env[key];
      process.env[key] = value;
    }
  });
  after(function () {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('Adaptive fast lane fair queueing', function () {
  beforeEach(truncateAll);
  after(truncateAll);

  describe('when a job has no measured work item duration yet', function () {
    it('limits how many of its work items run until one has been measured', async function () {
      await saveJobs([{ jobID: 'newJob', username: 'Ann', running: 0, ready: 10 }]);
      const counts = await takeBatch(10);
      expect(counts.newJob).to.be.at.least(2);
      expect(counts.newJob).to.be.below(10);
    });

    it('does not limit a job whose work items are measured as fast', async function () {
      await saveJobs([{ jobID: 'fastJob', username: 'Ann', running: 0, ready: 10, averageDuration: 1000 }]);
      expect(await takeBatch(10)).to.eql({ fastJob: 10 });
    });
  });

  describe('when a user has more than their fair share of the pods and another user is waiting', function () {
    it('gives the batch to the waiting user', async function () {
      await saveJobs([
        { jobID: 'busyJob', username: 'Busy', running: 8, ready: 10, averageDuration: 1000 },
        { jobID: 'waitingJob', username: 'Waiting', running: 0, ready: 10, averageDuration: 1000 },
      ]);
      expect(await takeBatch(2)).to.eql({ waitingJob: 2 });
    });

    it('splits the batch between the users under slot based fair queueing', async function () {
      await saveJobs([
        { jobID: 'busyJob', username: 'Busy', running: 8, ready: 10, averageDuration: 1000 },
        { jobID: 'waitingJob', username: 'Waiting', running: 0, ready: 10, averageDuration: 1000 },
      ]);
      expect(await takeBatch(2, slotBasedPolicy)).to.eql({ busyJob: 1, waitingJob: 1 });
    });
  });

  describe('when a user over their fair share has a sync request', function () {
    it('does not hold the sync request back', async function () {
      await saveJobs([
        { jobID: 'asyncJob', username: 'Busy', running: 5, ready: 10, averageDuration: 1000 },
        { jobID: 'syncJob', username: 'Busy', isAsync: false, running: 0, ready: 1 },
        { jobID: 'otherJob', username: 'Other', running: 0, ready: 10, averageDuration: 1000 },
      ]);
      // Busy has their share (5 of the 10 pods), so only the sync request is exempt
      expect(await takeBatch(2)).to.eql({ syncJob: 1, otherJob: 1 });
    });
  });

  describe('when slow work is running', function () {
    beforeEach(async function () {
      // 8 of the 10 pods are busy with slow work
      await saveJobs([{ jobID: 'slowJob', username: 'Slow', running: 8, ready: 10, averageDuration: 700000 }]);
    });

    it('lets slow work use all but 10% of the pods', async function () {
      expect(await takeBatch(5)).to.eql({ slowJob: 1 });
    });

    it('keeps 30% of the pods from slow work under duration based fair queueing', async function () {
      expect(await takeBatch(5, durationBasedPolicy)).to.eql({});
    });

    describe('and the reserve is set to the work-scheduler\'s', function () {
      hookEnv({ ADAPTIVE_FAST_LANE_RESERVE_FRACTION: 'scheduler' });

      it('keeps 30% of the pods from slow work', async function () {
        expect(await takeBatch(5)).to.eql({});
      });
    });
  });

  describe('when the simulator-only fixes are switched on', function () {
    hookEnv({ ADAPTIVE_FAST_LANE_EWMA_ALPHA: '0.2', ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION: 'true' });

    it('ignores them and still schedules work', async function () {
      await saveJobs([{ jobID: 'fastJob', username: 'Ann', running: 0, ready: 10, averageDuration: 1000 }]);
      expect(await takeBatch(10)).to.eql({ fastJob: 10 });
    });
  });
});

describe('getFairQueueingPolicy', function () {
  it('returns the named policy', function () {
    expect(getFairQueueingPolicy('slot-based')).to.equal(slotBasedPolicy);
    expect(getFairQueueingPolicy('duration-based')).to.equal(durationBasedPolicy);
    expect(getFairQueueingPolicy('adaptive-fast-lane')).to.equal(adaptiveFastLanePolicy);
  });

  it('returns duration based fair queueing for slot-based when ENABLE_DURATION_BASED_FAIR_QUEUEING is true', function () {
    expect(getFairQueueingPolicy('slot-based', true)).to.equal(durationBasedPolicy);
  });

  it('ignores ENABLE_DURATION_BASED_FAIR_QUEUEING when another policy is named', function () {
    expect(getFairQueueingPolicy('adaptive-fast-lane', true)).to.equal(adaptiveFastLanePolicy);
  });

  it('throws for an unknown policy', function () {
    expect(() => getFairQueueingPolicy('no-such-policy')).to.throw(/Unknown fair queueing policy "no-such-policy"/);
  });
});
