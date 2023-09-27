import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonSpy, SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as updater from '../app/workers/updater';
import * as queueFactory from '../../harmony/app/util/queue/queue-factory';
import { MemoryQueue } from '../../harmony/test/helpers/memory-queue';
import * as wi from '../../harmony/app/models/work-item';
import * as wiu from '../app/work-item-updates';
import { WorkItemQueueType } from '../../harmony/app/util/queue/queue';
import WorkItemUpdate from '../../harmony/app/models/work-item-update';
import DataOperation from '../../harmony/app/models/data-operation';

describe('Updater Worker', async function () {
  const smallUpdateQueue = new MemoryQueue();
  const largeUpdateQueue = new MemoryQueue();
  let getQueueForTypeStub: SinonStub;
  let getJobIdForWorkItemStub: SinonStub;
  let handleWorkItemUpdateWithJobIdStub: SinonStub;
  let handleBatchWorkItemUpdatesSpy: SinonSpy;

  before(function () {
    getQueueForTypeStub = sinon.stub(queueFactory, 'getQueueForType').callsFake(function (type: WorkItemQueueType) {
      if (type === WorkItemQueueType.SMALL_ITEM_UPDATE) {
        return smallUpdateQueue;
      }
      return largeUpdateQueue;
    });
    getJobIdForWorkItemStub = sinon.stub(wi, 'getJobIdForWorkItem').callsFake(async function (_id: number): Promise<string> {
      return 'jobID';
    });
    handleWorkItemUpdateWithJobIdStub = sinon.stub(wiu, 'handleWorkItemUpdateWithJobId').callsFake(async function (_jobID: string, _update: WorkItemUpdate, _operation: DataOperation, _logger: Logger): Promise<void> {
      return;
    });
    handleBatchWorkItemUpdatesSpy = sinon.spy(updater, 'handleBatchWorkItemUpdates');
  });

  after(function () {
    getQueueForTypeStub.restore();
    getJobIdForWorkItemStub.restore();
    handleWorkItemUpdateWithJobIdStub.restore();
    handleBatchWorkItemUpdatesSpy.restore();
  });

  this.beforeEach(function () {
    handleWorkItemUpdateWithJobIdStub.resetHistory();
    handleBatchWorkItemUpdatesSpy.resetHistory();
  });

  describe('large job update', async function () {

    beforeEach(async function () {
      await largeUpdateQueue.purge();
      await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
    });

    describe('when the queue is empty', async function () {
      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should not call handleWorkItemUpdateWithJobId', async function () {
        expect(handleWorkItemUpdateWithJobIdStub.called).to.be.false;
      });
    });

    describe('when the queue has one item', async function () {
      this.beforeEach(async function () {
        const update = { workItemId: 1 };
        const operation = {};
        await largeUpdateQueue.purge();
        await largeUpdateQueue.sendMessage(JSON.stringify({ update, operation }), '', false);
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
      });

      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should call handleWorkItemUpdateWithJobId once', async function () {
        expect(handleWorkItemUpdateWithJobIdStub.callCount).to.equal(1);
      });
    });

    describe('when the queue has two items', async function () {
      this.beforeEach(async function () {
        const update1 = { workItemId: 1 };
        const update2 = { workItemId: 2 };
        const operation = {};
        await largeUpdateQueue.purge();
        await largeUpdateQueue.sendMessage(JSON.stringify({ update: update1, operation }), '', false);
        await largeUpdateQueue.sendMessage(JSON.stringify({ update: update2, operation }), '', false);
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
      });

      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should call handleWorkItemUpdateWithJobId twice', async function () {
        expect(handleWorkItemUpdateWithJobIdStub.callCount).to.equal(2);
      });
      it('should not call handleBatchWorkItemUpdates', async function () {
        expect(handleBatchWorkItemUpdatesSpy.called).to.be.false;
      });
    });
  });

  describe('small job update', async function () {

    beforeEach(async function () {
      await smallUpdateQueue.purge();
      await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
    });

    describe('when the queue is empty', async function () {
      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should not call handleWorkItemUpdateWithJobId', async function () {
        await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
        expect(handleWorkItemUpdateWithJobIdStub.called).to.be.false;
      });
    });

    describe('when the queue has one item', async function () {
      this.beforeEach(async function () {
        const update = { workItemId: 1 };
        const operation = {};
        await smallUpdateQueue.purge();
        await smallUpdateQueue.sendMessage(JSON.stringify({ update, operation }), '', false);
        await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
      });

      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should call handleWorkItemUpdateWithJobId once', async function () {
        expect(handleWorkItemUpdateWithJobIdStub.callCount).to.equal(1);
      });
    });

    describe('when the queue has two items', async function () {
      this.beforeEach(async function () {
        const update1 = { workItemId: 1 };
        const update2 = { workItemId: 2 };
        const operation = {};
        await smallUpdateQueue.purge();
        await smallUpdateQueue.sendMessage(JSON.stringify({ update: update1, operation }), '', false);
        await smallUpdateQueue.sendMessage(JSON.stringify({ update: update2, operation }), '', false);
        await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
      });

      it('should call getQueueForType', async function () {
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should not call handleWorkItemUpdateWithJobId', async function () {
        expect(handleWorkItemUpdateWithJobIdStub.callCount).to.equal(0);
      });
      it('should call handleBatchWorkItemUpdates once', async function () {
        expect(handleBatchWorkItemUpdatesSpy.callCount).to.equal(1);
      });
    });
  });
});


