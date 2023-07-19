/* eslint-disable node/no-unpublished-import */
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as updater from '../app/workers/updater';
import * as queueFactory from '../../../app/util/queue/queue-factory';
import { MemoryQueue } from '../../../test/helpers/memory-queue';
import * as wi from '../../../app/models/work-item';
import * as wiu from '../../../app/backends/workflow-orchestration/work-item-updates';
import { WorkItemQueueType } from '../../../app/util/queue/queue';
import WorkItemUpdate from '../../../app/models/work-item-update';
import DataOperation from '../../../app/models/data-operation';

describe('Updater Worker', async function () {
  const smallUpdateQueue = new MemoryQueue();
  const largeUpdateQueue = new MemoryQueue();
  let getQueueForTypeStub: SinonStub;
  let getJobIdForWorkItemStub: SinonStub;
  let handleWorkItemUpdateWithJobIdStub: SinonStub;

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
  });

  after(function () {
    getQueueForTypeStub.restore();
    getJobIdForWorkItemStub.restore();
    handleWorkItemUpdateWithJobIdStub.restore();
  });

  describe('large job update', async function () {

    beforeEach(async function () {
      await largeUpdateQueue.purge();
    });

    describe('when the queue is empty', async function () {
      it('should call getQueueForType', async function () {
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should not call handleWorkItemUpdateWithJobId', async function () {
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
        expect(handleWorkItemUpdateWithJobIdStub.called).to.be.false;
      });
    });

    describe('when the queue has one item', async function () {
      this.beforeEach(async function () {
        const update = { workItemId: 1 };
        const operation = {};
        await largeUpdateQueue.purge();
        await largeUpdateQueue.sendMessage(JSON.stringify({ update, operation }), '', false);
        handleWorkItemUpdateWithJobIdStub.resetHistory();
      });

      it('should call getQueueForType', async function () {
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
        expect(getQueueForTypeStub.called).to.be.true;
      });
      it('should call handleWorkItemUpdateWithJobId once', async function () {
        await updater.batchProcessQueue(WorkItemQueueType.LARGE_ITEM_UPDATE);
        expect(handleWorkItemUpdateWithJobIdStub.callCount).to.equal(1);
      });
    });
  });

  // describe('small job update', async function () {
  // });

});

// describe('Scheduler Worker', async function () {
//   const service = 'foo:latest';

//   describe('processSchedulerQueue', async function () {
//     let getPodsCountForServiceStub: SinonStub;
//     let getWorkFromDatabaseStub: SinonStub;
//     let getSchedulerQueueStub: SinonStub;
//     let getQueueUrlForServiceStub: SinonStub;
//     let getQueueForUrlStub: SinonStub;
//     const schedulerQueue = new MemoryQueue();
//     let serviceQueues;

//     before(function () {
//       getPodsCountForServiceStub = sinon.stub(k8s, 'getPodsCountForService').callsFake(async function () {
//         return 1;
//       });
//       getWorkFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger) {
//         return { workItem: new WorkItem({ id: 1 }) } as WorkItemData;
//       });
//       getSchedulerQueueStub = sinon.stub(queueFactory, 'getWorkSchedulerQueue').callsFake(function () {
//         return schedulerQueue;
//       });
//       getQueueUrlForServiceStub = sinon.stub(queueFactory, 'getQueueUrlForService').callsFake(function (serviceID: string) { return serviceID; });
//       getQueueForUrlStub = sinon.stub(queueFactory, 'getQueueForUrl').callsFake(function (url: string) {
//         let queue = serviceQueues[url];
//         if (!queue) {
//           queue = new MemoryQueue();
//           serviceQueues[url] = queue;
//         }
//         return queue;
//       });
//     });

//     after(function () {
//       getPodsCountForServiceStub.restore();
//       getWorkFromDatabaseStub.restore();
//       getSchedulerQueueStub.restore();
//       getQueueForUrlStub.restore();
//       getQueueUrlForServiceStub.restore();
//     });

//     describe('when there is no work on the scheduler queue', async function () {

//       beforeEach(async function () {
//         await schedulerQueue.purge();
//         serviceQueues = {};
//         serviceQueues[service] = new MemoryQueue();
//         await scheduler.processSchedulerQueue(logger);
//       });
//       afterEach(async function () {
//         await schedulerQueue.purge();
//         serviceQueues = {};
//       });

//       it('does call getSchedulerQueue', async function () {
//         expect(getSchedulerQueueStub.called).to.be.true;
//       });

//       it('does not call getPodsCountForService', async function () {
//         expect(getPodsCountForServiceStub.called).to.be.false;
//       });

//       it('does not call getWorkFromDatabase', async function () {
//         expect(getWorkFromDatabaseStub.called).to.be.false;
//       });

//       it('does not call getQueueForUrl', async function () {
//         expect(getQueueForUrlStub.called).to.be.false;
//       });

//       it('doest not put any messages on the queue', async function () {
//         const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
//         expect(numMessages).to.equal(0);
//       });
//     });

//     describe('when there is work on the scheduler queue', async function () {

//       beforeEach(async function () {
//         await schedulerQueue.purge();
//         await schedulerQueue.sendMessage(service);
//         serviceQueues = {};
//         serviceQueues[service] = new MemoryQueue();
//         await scheduler.processSchedulerQueue(logger);
//       });
//       afterEach(async function () {
//         await schedulerQueue.purge();
//         serviceQueues = {};
//       });

//       it('calls getPodsCountForService', async function () {
//         expect(getPodsCountForServiceStub.called).to.be.true;
//       });

//       it('calls getWorkFromDatabase', async function () {
//         expect(getWorkFromDatabaseStub.called).to.be.true;
//       });

//       it('calls getSchedulerQueue', async function () {
//         expect(getSchedulerQueueStub.called).to.be.true;
//       });

//       it('calls getQueueForUrl', async function () {
//         expect(getQueueForUrlStub.called).to.be.true;
//       });

//       it('puts messages on the queue', async function () {
//         const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
//         expect(numMessages).to.equal(1);
//       });
//     });
//   });
// });

