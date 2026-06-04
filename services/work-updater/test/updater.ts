import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';

import * as wiu from '../../harmony/app/backends/workflow-orchestration/work-item-updates';
import * as jobModel from '../../harmony/app/models/job';
import * as wi from '../../harmony/app/models/work-item';
import { WorkItemStatus } from '../../harmony/app/models/work-item-interface';
import logger from '../../harmony/app/util/log';
import { Queue, WorkItemQueueType } from '../../harmony/app/util/queue/queue';
import * as queueFactory from '../../harmony/app/util/queue/queue-factory';
import { MemoryQueue } from '../../harmony/test/helpers/memory-queue';
import * as updater from '../app/workers/updater';

describe('Updater Worker', function () {
  const smallUpdateQueue = new MemoryQueue();
  const largeUpdateQueue = new MemoryQueue();
  let getQueueForTypeStub: sinon.SinonStub;
  let getJobIdForWorkItemStub: sinon.SinonStub;
  let handleBatchWorkItemUpdatesWithJobIdStub: sinon.SinonStub;
  let handleBatchWorkItemUpdatesSpy: sinon.SinonSpy;
  let getJobStatusForJobIDStub: sinon.SinonStub;

  before(function () {
    getQueueForTypeStub = sinon.stub(queueFactory, 'getQueueForType').callsFake(function (type: WorkItemQueueType) {
      return type === WorkItemQueueType.SMALL_ITEM_UPDATE ? smallUpdateQueue : largeUpdateQueue;
    });
    getJobIdForWorkItemStub = sinon.stub(wi, 'getJobIdForWorkItem').resolves('jobID');
    handleBatchWorkItemUpdatesWithJobIdStub = sinon.stub(wiu, 'handleBatchWorkItemUpdatesWithJobId').resolves();
    handleBatchWorkItemUpdatesSpy = sinon.spy(updater, 'handleBatchWorkItemUpdates');
    getJobStatusForJobIDStub = sinon.stub(jobModel, 'getJobStatusForJobID').resolves(jobModel.JobStatus.RUNNING);
  });

  after(function () {
    getQueueForTypeStub.restore();
    getJobIdForWorkItemStub.restore();
    handleBatchWorkItemUpdatesWithJobIdStub.restore();
    handleBatchWorkItemUpdatesSpy.restore();
    getJobStatusForJobIDStub.restore();
  });

  beforeEach(function () {
    handleBatchWorkItemUpdatesWithJobIdStub.resetHistory();
    handleBatchWorkItemUpdatesSpy.resetHistory();
  });

  describe('large update', function () {
    beforeEach(async function () {
      await largeUpdateQueue.purge();
      await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
    });

    it('should not call handleBatchWorkItemUpdates when queue is empty', function () {
      expect(handleBatchWorkItemUpdatesSpy.called).to.be.false;
    });

    it('should call handleBatchWorkItemUpdates once for each message', async function () {
      const update1 = { update: { workItemID: 1, status: 'successful' } };
      const update2 = { update: { workItemID: 2, status: 'failed' } };
      await largeUpdateQueue.sendMessage(JSON.stringify(update1), '', false);
      await largeUpdateQueue.sendMessage(JSON.stringify(update2), '', false);
      await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
      expect(handleBatchWorkItemUpdatesSpy.callCount).to.equal(2);
    });
  });

  describe('small update', function () {
    beforeEach(async function () {
      await smallUpdateQueue.purge();
      await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
    });

    it('should not call handleBatchWorkItemUpdates when queue is empty', function () {
      expect(handleBatchWorkItemUpdatesSpy.called).to.be.false;
    });

    it('should call handleBatchWorkItemUpdates once for all messages', async function () {
      const update1 = { update: { workItemID: 1, status: 'successful' } };
      const update2 = { update: { workItemID: 2, status: 'failed' } };
      await smallUpdateQueue.sendMessage(JSON.stringify(update1), '', false);
      await smallUpdateQueue.sendMessage(JSON.stringify(update2), '', false);
      await updater.batchProcessQueue(WorkItemQueueType.SMALL_ITEM_UPDATE);
      expect(handleBatchWorkItemUpdatesSpy.callCount).to.equal(1);
    });
  });

  describe('handleBatchWorkItemUpdates', function () {
    beforeEach(function () {
      if (getJobIdForWorkItemStub.restore) {
        getJobIdForWorkItemStub.restore();
      }
      getJobIdForWorkItemStub = sinon.stub(wi, 'getJobIdForWorkItem');
      getJobIdForWorkItemStub.onFirstCall().resolves('job1');
      getJobIdForWorkItemStub.onSecondCall().resolves('job1');
      getJobIdForWorkItemStub.onThirdCall().resolves('job2');
    });

    afterEach(function () {
      getJobIdForWorkItemStub.restore();
    });

    it('should group updates by jobID and call handleBatchWorkItemUpdatesWithJobId', async function () {
      const updates = [
        { update: { workItemID: 1, status: WorkItemStatus.SUCCESSFUL } },
        { update: { workItemID: 2, status: WorkItemStatus.FAILED } },
        { update: { workItemID: 3, status: WorkItemStatus.RUNNING } },
      ];

      await updater.handleBatchWorkItemUpdates(updates, logger);

      expect(handleBatchWorkItemUpdatesWithJobIdStub.callCount).to.equal(2);
      expect(handleBatchWorkItemUpdatesWithJobIdStub.firstCall.args[0]).to.equal('job1');
      expect(handleBatchWorkItemUpdatesWithJobIdStub.firstCall.args[1]).to.have.lengthOf(2);
      expect(handleBatchWorkItemUpdatesWithJobIdStub.secondCall.args[0]).to.equal('job2');
      expect(handleBatchWorkItemUpdatesWithJobIdStub.secondCall.args[1]).to.have.lengthOf(1);
    });

    it('should not process updates for jobs in terminal states', async function () {
      const updates = [
        { update: { workItemID: 1, status: WorkItemStatus.SUCCESSFUL },
          operation: null,
        },
      ];
      getJobIdForWorkItemStub.resolves('job1');
      getJobStatusForJobIDStub.resolves('successful');

      await updater.handleBatchWorkItemUpdates(updates, logger);

      expect(handleBatchWorkItemUpdatesWithJobIdStub.callCount).to.equal(0);
    });
  });

  describe('startVisibilityHeartbeat', function () {
    let clock: sinon.SinonFakeTimers;

    beforeEach(function () {
      clock = sinon.useFakeTimers();
    });

    afterEach(function () {
      clock.restore();
    });

    it('should not extend visibility before the initial delay', async function () {
      const queue = {
        changeMessageVisibilities: sinon.stub().resolves(),
      } as unknown as Queue;

      const stop = updater.startVisibilityHeartbeat(
        queue,
        ['receipt1'],
        15,
        30,
        60,
      );

      await clock.tickAsync(14999);

      expect(
        (queue.changeMessageVisibilities as sinon.SinonStub).called,
      ).to.be.false;

      stop();
    });

    it('should extend visibility after the initial delay', async function () {
      const queue = {
        changeMessageVisibilities: sinon.stub().resolves(),
      } as unknown as Queue;

      const stop = updater.startVisibilityHeartbeat(
        queue,
        ['receipt1', 'receipt2'],
        15,
        30,
        60,
      );

      await clock.tickAsync(15000);

      const stub = queue.changeMessageVisibilities as sinon.SinonStub;

      expect(stub.calledOnce).to.be.true;
      expect(stub.firstCall.args).to.deep.equal([
        ['receipt1', 'receipt2'],
        60,
      ]);

      stop();
    });

    it('should continue extending visibility at the refresh interval', async function () {
      const queue = {
        changeMessageVisibilities: sinon.stub().resolves(),
      } as unknown as Queue;

      const stop = updater.startVisibilityHeartbeat(
        queue,
        ['receipt1'],
        15,
        30,
        60,
      );

      const stub = queue.changeMessageVisibilities as sinon.SinonStub;

      await clock.tickAsync(15000);
      expect(stub.callCount).to.equal(1);

      await clock.tickAsync(30000);
      expect(stub.callCount).to.equal(2);

      await clock.tickAsync(30000);
      expect(stub.callCount).to.equal(3);

      stop();
    });

    it('should stop extending visibility after cleanup', async function () {
      const queue = {
        changeMessageVisibilities: sinon.stub().resolves(),
      } as unknown as Queue;

      const stop = updater.startVisibilityHeartbeat(
        queue,
        ['receipt1'],
        15,
        30,
        60,
      );

      const stub = queue.changeMessageVisibilities as sinon.SinonStub;

      await clock.tickAsync(15000);
      expect(stub.callCount).to.equal(1);

      stop();

      await clock.tickAsync(120000);

      expect(stub.callCount).to.equal(1);
    });

    it('should extend visibility while processing a long running batch', async function () {
      const queue = new MemoryQueue();

      const visibilityStub = sinon.stub(queue, 'changeMessageVisibilities').resolves();

      getQueueForTypeStub.callsFake(function () {
        return queue;
      });

      await queue.sendMessage(
        JSON.stringify({
          update: {
            workItemID: 1,
            status: WorkItemStatus.RUNNING,
          },
        }),
        '',
        false,
      );

      handleBatchWorkItemUpdatesSpy.restore();

      const processingStub = sinon.stub(updater, 'handleBatchWorkItemUpdates')
        .callsFake(async () => {
          await clock.tickAsync(20000);
        });

      const processingPromise = updater.batchProcessQueue(
        WorkItemQueueType.SMALL_ITEM_UPDATE,
      );

      await clock.tickAsync(15000);

      expect(visibilityStub.calledOnce).to.be.true;

      await processingPromise;

      processingStub.restore();
    });
  });
});
