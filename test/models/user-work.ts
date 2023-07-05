import { expect } from 'chai';
import { decrementRunningCount, getCount, incrementReadyAndDecrementRunningCounts, incrementRunningAndDecrementReadyCounts } from '../../app/models/user-work';
import db from '../../app/util/db';
import { truncateAll } from '../helpers/db';
import { createUserWorkRecord } from '../helpers/user-work';

describe('user_work table', async function () {
  describe('when creating a row and setting the ready and running counts to positive values', async function () {
    const userWork = createUserWorkRecord( { ready_count: 9, running_count: 5 });
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
    const userWork = createUserWorkRecord( { ready_count: 9, running_count: 0 });
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
    const userWork = createUserWorkRecord( { ready_count: 0, running_count: 4 });
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
});
