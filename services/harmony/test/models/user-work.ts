import { expect } from 'chai';
import {
  decrementRunningCount, getCount, incrementReadyAndDecrementRunningCounts,
  incrementRunningAndDecrementReadyCounts, deleteUserWorkForCompletedJobAndServices,
} from '../../app/models/user-work';
import db from '../../app/util/db';
import { truncateAll } from '../helpers/db';
import { rowExists, createUserWorkRecord } from '../helpers/user-work';

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

  describe('calling deleteUserWorkForCompletedJobAndServices', function () {
    const jobId = 'JobID-uuid';
    const serviceId = 'harmony/service-image:1.0.0';
    const serviceId2 = 'harmony/service-image:2.0.0';

    afterEach(async function () { await truncateAll(); });

    it('deletes matching rows and returns 1 when ready_count and running_count are both 0', async function () {
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 0, running_count: 0,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId]);

      expect(numDeleted).to.equal(1);
      expect(await rowExists(jobId, serviceId)).to.equal(false);
    });

    it('leaves the row and returns 0 when ready_count > 0', async function () {
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 3, running_count: 0,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId]);

      expect(numDeleted).to.equal(0);
      expect(await rowExists(jobId, serviceId)).to.equal(true);
    });

    it('leaves the row and returns 0 when running_count > 0', async function () {
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 0, running_count: 2,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId]);

      expect(numDeleted).to.equal(0);
      expect(await rowExists(jobId, serviceId)).to.equal(true);
    });

    it('returns 0 when no matching row exists', async function () {
      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, 'missing-job', ['missing-svc']);
      expect(numDeleted).to.equal(0);
    });

    it('does not delete rows for other jobs that share the same serviceID', async function () {
      await createUserWorkRecord({
        job_id: 'other-jobs-uuid', service_id: serviceId, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 0, running_count: 0,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId]);

      expect(numDeleted).to.equal(1);
      expect(await rowExists(jobId, serviceId)).to.equal(false);
      expect(await rowExists('other-jobs-uuid', serviceId)).to.equal(true);
    });

    it('deletes multiple service rows for the same job when all have zero counts', async function () {
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId2, ready_count: 0, running_count: 0,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId, serviceId2]);

      expect(numDeleted).to.equal(2);
      expect(await rowExists(jobId, serviceId)).to.equal(false);
      expect(await rowExists(jobId, serviceId2)).to.equal(false);
    });

    it('only deletes completed rows when serviceIds list contains mixed-state services', async function () {
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobId, service_id: serviceId2, ready_count: 1, running_count: 0,
      }).save(db);

      const numDeleted = await deleteUserWorkForCompletedJobAndServices(db, jobId, [serviceId, serviceId2]);

      expect(numDeleted).to.equal(1);
      expect(await rowExists(jobId, serviceId)).to.equal(false);
      expect(await rowExists(jobId, serviceId2)).to.equal(true);
    });

  });
});
