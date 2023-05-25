import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as scheduler from '../app/workers/scheduler';
import * as k8s from '../app/util/k8s';
import * as workItemPolling from '../../../app/backends/workflow-orchestration/work-item-polling';
import * as queueFactory from '../../../app/util/queue/queue-factory';
import logger from '../../../app/util/log';
import { MemoryQueue } from '../../../test/helpers/memory-queue';


// tests
// before
//   - mock k8sApi.listNamespacedPod
//   - mock getPodsCountForService
//   - mock getQueueForUrl
//   - mock getWorkFromDatabase
//   - mock getWorkSchedulerQueue
//   - load memory queue with service IDs
// test
//   - call processSchedulerQueue
//   - assert that getPodsCountForService was called
//   - assert that getWorkFromDatabase was called
//   - assert that getWorkSchedulerQueue was called
//   - assert that getQueueForUrl was called
//   - assert that queue.sendMessageBatch was called with the correct number of messages
// after
//   - restore all mocks
describe('Scheduler Worker', async function () {
  describe('processSchedulerQueue', async function () {
    let getPodsCountForServiceStub: SinonStub;
    let getWorkFromDatabaseStub: SinonStub;
    let getSchedulerQueueStub: SinonStub;
    let getQueueUrlForServiceStub: SinonStub;
    let getQueueForUrlStub: SinonStub;
    const schedulerQueue = new MemoryQueue();
    let serviceQueues;

    before(function () {
      getPodsCountForServiceStub = sinon.stub(k8s, 'getPodsCountForService').callsFake(async function () {
        return 1;
      });
      getWorkFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger) {
        return null;
      });
      getSchedulerQueueStub = sinon.stub(queueFactory, 'getWorkSchedulerQueue').callsFake(function () {
        return schedulerQueue;
      });
      getQueueUrlForServiceStub = sinon.stub(queueFactory, 'getQueueUrlForService').callsFake(function (serviceID: string) { return serviceID; });
      getQueueForUrlStub = sinon.stub(queueFactory, 'getQueueForUrl').callsFake(function (url: string) {
        let queue = serviceQueues[url];
        if (!queue) {
          queue = new MemoryQueue();
          serviceQueues[url] = queue;
        }
        return queue;
      });
    });

    after(function () {
      getPodsCountForServiceStub.restore();
      getWorkFromDatabaseStub.restore();
      getSchedulerQueueStub.restore();
      getQueueForUrlStub.restore();
      getQueueUrlForServiceStub.restore();
    });

    describe('when there is no work in the scheduler queue', async function () {
      // let sendMessageBatchStub: SinonStub;

      beforeEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
      });
      afterEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
      });

      it('does call getSchedulerQueue', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getSchedulerQueueStub.called).to.be.true;
      });

      it('does not call getPodsCountForService', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getPodsCountForServiceStub.called).to.be.false;
      });

      it('does not call getWorkFromDatabase', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getWorkFromDatabaseStub.called).to.be.false;
      });

      it('does not call getQueueForUrl', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getQueueForUrlStub.called).to.be.false;
      });

      // it('does not call sendMessageBatch', async function () {
      //   await scheduler.processSchedulerQueue(logger);
      //   expect(sendMessageBatchStub.called).to.be.false;
      // });
    });

    describe('when there is work in the scheduler queue', async function () {

      beforeEach(async function () {
        await schedulerQueue.purge();
        await schedulerQueue.sendMessage('foo:latest');
        serviceQueues = {};
      });
      afterEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
      });

      it('calls getPodsCountForService', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getPodsCountForServiceStub.called).to.be.true;
      });

      it('calls getWorkFromDatabase', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getWorkFromDatabaseStub.called).to.be.true;
      });

      it('calls getSchedulerQueue', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getSchedulerQueueStub.called).to.be.true;
      });

      it('calls getQueueForUrl', async function () {
        await scheduler.processSchedulerQueue(logger);
        expect(getQueueForUrlStub.called).to.be.true;
      });

      // it('calls sendMessageBatch', async function () {
      //   await scheduler.processSchedulerQueue(logger);
      //   expect(sendMessageBatchStub.called).to.be.true;
      // });
    });
  });
});

