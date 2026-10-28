import { expect } from 'chai';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import UserWork, {
  decrementRunningCount, DEFAULT_EXPECTED_DURATION_MS, getLiveWork, getNextJobIds,
  incrementReadyAndDecrementRunningCounts, incrementRunningAndDecrementReadyCounts,
} from '../../app/models/user-work';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { createUserWorkRecord, getCount } from '../helpers/user-work';

describe('getNextJobIds', function () {
  const serviceID = 'sync-priority-service';

  afterEach(async function () {
    await truncateAll();
  });

  describe('when the same user has one synchronous and one older asynchronous job ready', function () {
    beforeEach(async function () {
      // async job, worked least recently (would win on last_worked alone)
      await createUserWorkRecord({
        job_id: 'asyncJob', service_id: serviceID, username: 'sameUser',
        ready_count: 1, is_async: true, last_worked: new Date(1000),
      }).save(db);
      // sync job, worked more recently, but should still rank first for this user
      await createUserWorkRecord({
        job_id: 'syncJob', service_id: serviceID, username: 'sameUser',
        ready_count: 1, is_async: false, last_worked: new Date(2000),
      }).save(db);
    });

    it('ranks the synchronous job ahead of the older asynchronous job with slot based fair queueing', async function () {
      const { jobs } = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger));
      expect(jobs.map((j) => j.jobId)).to.eql(['syncJob', 'asyncJob']);
    });

    it('ranks the synchronous job ahead of the older asynchronous job with duration based fair queueing', async function () {
      const { jobs } = await db.transaction((tx) => getNextJobIds(
        tx, serviceID, 10, logger,
        { servicePodCount: 1000, slowWorkThresholdMs: 600_000, fastLaneReserveFraction: 0.3 }));
      expect(jobs.map((j) => j.jobId)).to.eql(['syncJob', 'asyncJob']);
    });
  });

  describe('when a user has many work items running for another service', function () {
    beforeEach(async function () {
      // busyElsewhereUser has the most running work (and expected runtime) overall, but none for
      // this service
      await createUserWorkRecord({
        job_id: 'otherServiceJob', service_id: 'other-service', username: 'busyElsewhereUser',
        running_count: 10, average_duration: 1000, completed_count: 1, last_worked: new Date(1000),
      }).save(db);
      await createUserWorkRecord({
        job_id: 'busyElsewhereJob', service_id: serviceID, username: 'busyElsewhereUser',
        ready_count: 1, average_duration: 1000, completed_count: 1, last_worked: new Date(2000),
      }).save(db);
      // busyHereUser has less running work overall, but some for this service, and was worked
      // less recently, so would win any tie
      await createUserWorkRecord({
        job_id: 'busyHereJob', service_id: serviceID, username: 'busyHereUser',
        ready_count: 1, running_count: 1, average_duration: 1000, completed_count: 1, last_worked: new Date(500),
      }).save(db);
    });

    it('only counts the running work items for the service being scheduled with slot based fair queueing', async function () {
      const { jobs } = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger));
      expect(jobs.map((j) => j.jobId)).to.eql(['busyElsewhereJob', 'busyHereJob']);
    });

    it('only counts the expected runtime for the service being scheduled with duration based fair queueing', async function () {
      const { jobs } = await db.transaction((tx) => getNextJobIds(
        tx, serviceID, 10, logger,
        { servicePodCount: 1000, slowWorkThresholdMs: 600_000, fastLaneReserveFraction: 0.3 }));
      expect(jobs.map((j) => j.jobId)).to.eql(['busyElsewhereJob', 'busyHereJob']);
    });
  });

  describe('when using slot based fair queueing and a job is measured as slow', function () {
    beforeEach(async function () {
      await createUserWorkRecord({
        job_id: 'slowJob', service_id: serviceID, username: 'slowUser',
        ready_count: 1, running_count: 5, average_duration: 700_000, completed_count: 1,
      }).save(db);
    });

    it('does not classify the job as slow or limit the slow work slots', async function () {
      const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger));
      expect(result).to.eql({ jobs: [{ jobId: 'slowJob', isSlow: false }], availableSlowWorkSlots: Infinity });
    });
  });

  describe('when using duration based fair queueing with jobs that have failed work items', function () {
    // 10 pods with 30% reserved for fast work leaves capacity for 7 slow work items
    const options = { servicePodCount: 10, slowWorkThresholdMs: 600_000, fastLaneReserveFraction: 0.3 };

    describe('and a job with no successes whose work items fail slowly', function () {
      beforeEach(async function () {
        await createUserWorkRecord({
          job_id: 'failingSlowJob', service_id: serviceID, username: 'failingUser', ready_count: 1,
          failed_count: 2, failed_sum_duration_ms: 1_400_000,
        }).save(db);
      });

      it('classifies the job as slow by its average failure time', async function () {
        const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
        expect(result).to.eql({ jobs: [{ jobId: 'failingSlowJob', isSlow: true }], availableSlowWorkSlots: 7 });
      });

      describe('when the slow work capacity is already used up', function () {
        beforeEach(async function () {
          await createUserWorkRecord({
            job_id: 'slowJob', service_id: serviceID, username: 'slowUser', running_count: 7,
            average_duration: 700_000, completed_count: 1,
          }).save(db);
          await createUserWorkRecord({
            job_id: 'fastJob', service_id: serviceID, username: 'fastUser', ready_count: 1,
            average_duration: 1000, completed_count: 1,
          }).save(db);
        });

        it('excludes the job rather than treating it as unmeasured', async function () {
          const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
          expect(result).to.eql({ jobs: [{ jobId: 'fastJob', isSlow: false }], availableSlowWorkSlots: 0 });
        });
      });
    });

    describe('and a job with no successes whose work items are running and fail slowly', function () {
      beforeEach(async function () {
        await createUserWorkRecord({
          job_id: 'failingSlowJob', service_id: serviceID, username: 'failingUser', running_count: 7,
          failed_count: 1, failed_sum_duration_ms: 700_000,
        }).save(db);
        await createUserWorkRecord({
          job_id: 'slowJob', service_id: serviceID, username: 'slowUser', ready_count: 1,
          average_duration: 700_000, completed_count: 1,
        }).save(db);
      });

      it('counts its running work items against the slow work capacity', async function () {
        const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
        expect(result).to.eql({ jobs: [], availableSlowWorkSlots: 0 });
      });
    });

    describe('and a job with no successes whose work items fail quickly', function () {
      beforeEach(async function () {
        await createUserWorkRecord({
          job_id: 'failingFastJob', service_id: serviceID, username: 'failingUser', ready_count: 1,
          running_count: 3, failed_count: 2, failed_sum_duration_ms: 2000,
        }).save(db);
        await createUserWorkRecord({
          job_id: 'slowJob', service_id: serviceID, username: 'slowUser', running_count: 7,
          average_duration: 700_000, completed_count: 1,
        }).save(db);
      });

      it('classifies the job as fast, so it is still scheduled while slow work is blocked', async function () {
        const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
        expect(result.jobs).to.eql([{ jobId: 'failingFastJob', isSlow: false }]);
      });
    });

    describe('and a job with fast successes and slow failures', function () {
      beforeEach(async function () {
        await createUserWorkRecord({
          job_id: 'mixedJob', service_id: serviceID, username: 'mixedUser', ready_count: 1,
          average_duration: 1000, completed_count: 1, failed_count: 5, failed_sum_duration_ms: 4_500_000,
        }).save(db);
      });

      it('classifies the job by its successful work items only', async function () {
        const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
        expect(result.jobs).to.eql([{ jobId: 'mixedJob', isSlow: false }]);
      });
    });

    describe('and a job with no successes, a slow seeded duration, and fast failures', function () {
      beforeEach(async function () {
        await createUserWorkRecord({
          job_id: 'seededJob', service_id: serviceID, username: 'seededUser', ready_count: 1,
          average_duration: 900_000, failed_count: 1, failed_sum_duration_ms: 1000,
        }).save(db);
      });

      it('classifies the job by its own failures rather than the seed', async function () {
        const result = await db.transaction((tx) => getNextJobIds(tx, serviceID, 10, logger, options));
        expect(result.jobs).to.eql([{ jobId: 'seededJob', isSlow: false }]);
      });
    });
  });
});

describe('user_work table', async function () {
  describe('when creating a row and setting the ready and running counts to positive values', async function () {
    const userWork = createUserWorkRecord({ ready_count: 9, running_count: 5 });
    before(async function () {
      await userWork.save(db);
    });
    after(async function () {
      await truncateAll();
    });

    describe('when calling incrementRunningAndDecrementReadyCounts', async function () {
      before(async function () {
        await incrementRunningAndDecrementReadyCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(6);
      });
      it('subtracts one from the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(8);
      });
    });

    describe('when calling incrementReadyAndDecrementRunningCounts', async function () {
      before(async function () {
        userWork.ready_count = 4;
        userWork.running_count = 8;
        await userWork.save(db);
        await incrementReadyAndDecrementRunningCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(5);
      });
      it('subtracts one from the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(7);
      });
    });

    describe('when calling decrementRunningCount', async function () {
      before(async function () {
        userWork.ready_count = 4;
        userWork.running_count = 15;
        await userWork.save(db);
        await decrementRunningCount(db, userWork.job_id, userWork.service_id);
      });

      it('does not change the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(4);
      });
      it('subtracts one from the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(14);
      });
    });
  });

  describe('when the ready count is a positive value, and the running count is 0', function () {
    const userWork = createUserWorkRecord({ ready_count: 9, running_count: 0 });
    before(async function () {
      await userWork.save(db);
    });
    after(async function () {
      await truncateAll();
    });

    describe('when calling incrementReadyAndDecrementRunningCounts', async function () {
      before(async function () {
        await incrementReadyAndDecrementRunningCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(10);
      });
      it('leaves the running_count set to zero instead of making it negative', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(0);
      });
    });

    describe('when calling decrementRunningCount', async function () {
      before(async function () {
        userWork.ready_count = 9;
        userWork.running_count = 0;
        await userWork.save(db);
        await decrementRunningCount(db, userWork.job_id, userWork.service_id);
      });

      it('leaves the running_count set to zero instead of making it negative', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(0);
      });
    });

    describe('when calling incrementRunningAndDecrementReadyCounts', function () {
      before(async function () {
        userWork.ready_count = 9;
        userWork.running_count = 0;
        await userWork.save(db);
        await incrementRunningAndDecrementReadyCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(1);
      });
      it('subtracts one from the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(8);
      });
    });
  });

  describe('when the ready count is 0, and the running count is a positive value', async function () {
    const userWork = createUserWorkRecord({ ready_count: 0, running_count: 4 });
    before(async function () {
      await userWork.save(db);
    });
    after(async function () {
      await truncateAll();
    });

    describe('when calling incrementRunningAndDecrementReadyCounts', async function () {
      before(async function () {
        await incrementRunningAndDecrementReadyCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(5);
      });

      it('leaves the ready count set to zero instead of making it negative', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(0);
      });
    });

    describe('when calling incrementReadyAndDecrementRunningCounts', async function () {
      before(async function () {
        userWork.ready_count = 0;
        userWork.running_count = 4;
        await userWork.save(db);
        await incrementReadyAndDecrementRunningCounts(db, userWork.job_id, userWork.service_id);
      });

      it('adds one to the ready_count', async function () {
        const readyCount = await getCount(db, userWork.job_id, userWork.service_id, 'ready');
        expect(readyCount).to.equal(1);
      });
      it('subtracts one from the running_count', async function () {
        const runningCount = await getCount(db, userWork.job_id, userWork.service_id, 'running');
        expect(runningCount).to.equal(3);
      });
    });
  });

  describe('when calling decrementRunningCount with a completed work item duration', async function () {
    after(truncateAll);

    describe('on a row with no prior average', async function () {
      const userWork = createUserWorkRecord({ job_id: 'avg1', service_id: 'bar', running_count: 2 });
      before(async function () {
        await userWork.save(db);
        await decrementRunningCount(db, userWork.job_id, userWork.service_id, { durationMs: 1000, failed: false });
      });

      it('sets the average_duration to the duration of the first completed work item', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.average_duration).to.equal(1000);
      });

      it('sets completed_count to 1', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.completed_count).to.equal(1);
      });

      it('subtracts one from the running_count in the same update', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.running_count).to.equal(1);
      });
    });

    describe('on a row with a prior average', async function () {
      const userWork = createUserWorkRecord({
        job_id: 'avg2', service_id: 'bar', running_count: 2, average_duration: 1000, completed_count: 1,
      });
      before(async function () {
        await userWork.save(db);
        await decrementRunningCount(db, userWork.job_id, userWork.service_id, { durationMs: 3000, failed: false });
      });

      it('updates average_duration to the cumulative mean of all completed durations', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.average_duration).to.equal(2000);
      });

      it('increments completed_count', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.completed_count).to.equal(2);
      });
    });

    describe('without a duration', async function () {
      const userWork = createUserWorkRecord({
        job_id: 'avg3', service_id: 'bar', running_count: 2, average_duration: 1000, completed_count: 1,
      });
      before(async function () {
        await userWork.save(db);
        await decrementRunningCount(db, userWork.job_id, userWork.service_id);
      });

      it('leaves average_duration and completed_count unchanged', async function () {
        const row = await db(UserWork.table).where({ job_id: userWork.job_id, service_id: userWork.service_id }).first();
        expect(row.average_duration).to.equal(1000);
        expect(row.completed_count).to.equal(1);
      });
    });
  });
});

describe('getLiveWork estimated compute time of ready work', function () {
  const serviceID = 'estimate-service';

  before(async function () {
    await truncateAll();
    const rows: Partial<UserWork>[] = [
      // measured: 3 x 1 s
      { job_id: 'measured', username: 'alice', ready_count: 3, average_duration: 1000, completed_count: 2 },
      // no successes yet, only failures averaging 10 s: 2 x 10 s
      { job_id: 'failing', username: 'alice', ready_count: 2, failed_count: 2, failed_sum_duration_ms: 20000 },
      // seeded from the user's history (no completions of its own yet): 4 x 0.5 s
      { job_id: 'seeded', username: 'bob', ready_count: 4, average_duration: 500, completed_count: 0 },
      // nothing to estimate from: the default
      { job_id: 'unmeasured', username: 'bob', ready_count: 1 },
      // running only - no ready work to estimate
      { job_id: 'running', username: 'carol', running_count: 5 },
    ];
    for (const row of rows) {
      await createUserWorkRecord({ service_id: serviceID, ...row }).save(db);
    }
  });

  after(async function () {
    await truncateAll();
  });

  it('estimates each job\'s ready work items with its own duration for the service, or the default', async function () {
    const [service] = await getLiveWork(db, ['service_id']);
    expect(service.readyEstimateMs).to.equal(3000 + 20000 + 2000 + DEFAULT_EXPECTED_DURATION_MS);
    expect(service.readyDefaultEstimateCount).to.equal(1);
  });

  it('estimates by user', async function () {
    const byUser = Object.fromEntries((await getLiveWork(db, ['username'])).map((r) => [r.username, r]));
    expect(byUser.alice).to.include({ readyEstimateMs: 23000, readyDefaultEstimateCount: 0 });
    expect(byUser.bob).to.include({ readyEstimateMs: 2000 + DEFAULT_EXPECTED_DURATION_MS, readyDefaultEstimateCount: 1 });
    expect(byUser.carol).to.include({ readyEstimateMs: 0, readyDefaultEstimateCount: 0 });
  });
});
