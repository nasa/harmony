import { expect } from 'chai';
import * as sinon from 'sinon';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import {
  revertQueuedWorkItemsToReady, WorkItemData,
} from '../../app/backends/workflow-orchestration/work-item-polling';
import UserWork from '../../app/models/user-work';
import * as userWorkModel from '../../app/models/user-work';
import WorkItem from '../../app/models/work-item';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { createUserWorkRecord, rowExists } from '../helpers/user-work';
import { rawSaveWorkItem } from '../helpers/work-items';

describe('revertQueuedWorkItemsToReady', function () {
  const jobID = 'job-revert-queued';
  const serviceID = 'harmony/some-service:1.0.0';

  afterEach(async function () {
    await truncateAll();
  });

  describe('when the work items are still queued', function () {
    let workItem: WorkItem;
    let workItems: WorkItemData[];

    beforeEach(async function () {
      await createUserWorkRecord({
        job_id: jobID, service_id: serviceID, ready_count: 0, running_count: 1,
      }).save(db);
      workItem = await rawSaveWorkItem(db, {
        jobID, serviceID, status: WorkItemStatus.QUEUED,
      });
      workItems = [{ workItem }];
      await revertQueuedWorkItemsToReady(workItems, logger);
    });

    it('reverts the work item status back to ready', async function () {
      const reloaded = await db(WorkItem.table).where({ id: workItem.id }).first();
      expect(reloaded.status).to.equal(WorkItemStatus.READY);
    });

    it('increments ready_count and decrements running_count', async function () {
      const row = await db(UserWork.table).where({ job_id: jobID, service_id: serviceID }).first();
      expect(row.ready_count).to.equal(1);
      expect(row.running_count).to.equal(0);
    });
  });

  describe('when a work item was canceled before the revert runs', function () {
    let canceledItem: WorkItem;
    let queuedItem: WorkItem;

    beforeEach(async function () {
      await createUserWorkRecord({
        job_id: jobID, service_id: serviceID, ready_count: 0, running_count: 2,
      }).save(db);
      canceledItem = await rawSaveWorkItem(db, {
        jobID, serviceID, status: WorkItemStatus.CANCELED,
      });
      queuedItem = await rawSaveWorkItem(db, {
        jobID, serviceID, status: WorkItemStatus.QUEUED,
      });
      await revertQueuedWorkItemsToReady(
        [{ workItem: canceledItem }, { workItem: queuedItem }], logger,
      );
    });

    it('does not resurrect the canceled work item', async function () {
      const reloaded = await db(WorkItem.table).where({ id: canceledItem.id }).first();
      expect(reloaded.status).to.equal(WorkItemStatus.CANCELED);
    });

    it('still reverts the item that was genuinely queued', async function () {
      const reloaded = await db(WorkItem.table).where({ id: queuedItem.id }).first();
      expect(reloaded.status).to.equal(WorkItemStatus.READY);
    });

    it('only adjusts counts for the item that was actually reverted', async function () {
      const row = await db(UserWork.table).where({ job_id: jobID, service_id: serviceID }).first();
      expect(row.ready_count).to.equal(1);
      expect(row.running_count).to.equal(1);
    });
  });

  describe('when the revert transaction fails', function () {
    let incrementStub: sinon.SinonStub;
    let workItem: WorkItem;

    beforeEach(async function () {
      await createUserWorkRecord({
        job_id: jobID, service_id: serviceID, ready_count: 0, running_count: 1,
      }).save(db);
      workItem = await rawSaveWorkItem(db, {
        jobID, serviceID, status: WorkItemStatus.QUEUED,
      });
      incrementStub = sinon.stub(userWorkModel, 'incrementReadyAndDecrementRunningCounts')
        .rejects(new Error('database is unavailable'));
    });

    afterEach(function () {
      incrementStub.restore();
    });

    it('rethrows so the caller does not treat the revert as successful', async function () {
      let caughtError: Error;
      try {
        await revertQueuedWorkItemsToReady([{ workItem }], logger);
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError?.message).to.equal('database is unavailable');
    });

    it('does not leave the work item reverted, since the whole transaction rolled back', async function () {
      try {
        await revertQueuedWorkItemsToReady([{ workItem }], logger);
      } catch {
        // expected
      }
      const reloaded = await db(WorkItem.table).where({ id: workItem.id }).first();
      expect(reloaded.status).to.equal(WorkItemStatus.QUEUED);
    });
  });

  describe('when there are no work items to revert', function () {
    it('does nothing and does not throw', async function () {
      await revertQueuedWorkItemsToReady([], logger);
      expect(await rowExists(jobID, serviceID)).to.be.false;
    });
  });
});
