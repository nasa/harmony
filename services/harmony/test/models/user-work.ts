import { expect } from 'chai';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import UserWork, {
  decrementRunningCount, getCount, getNextJobIds, incrementReadyAndDecrementRunningCounts,
  incrementRunningAndDecrementReadyCounts,
} from '../../app/models/user-work';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { createUserWorkRecord } from '../helpers/user-work';

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

    it('ranks the synchronous job ahead of the older asynchronous job', async function () {
      const { jobs } = await db.transaction((tx) => getNextJobIds(
        tx, serviceID, 10, 1000, logger, 600_000, 0.3));
      expect(jobs.map((j) => j.jobId)).to.eql(['syncJob', 'asyncJob']);
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
        await decrementRunningCount(db, userWork.job_id, userWork.service_id, 1000);
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
        await decrementRunningCount(db, userWork.job_id, userWork.service_id, 3000);
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
