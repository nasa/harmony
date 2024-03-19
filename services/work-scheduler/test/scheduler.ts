import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as scheduler from '../app/workers/scheduler';
import * as k8s from '../app/util/k8s';
import * as workItemPolling from '../../harmony/app/backends/workflow-orchestration/work-item-polling';
import { queuefactory as qf } from '@harmony/util';
import logger from '../../harmony/app/util/log';
import { MemoryQueue } from '../../harmony/test/helpers/memory-queue';
import WorkItem from '../../harmony/app/models/work-item';
import { WorkItemData } from '../../harmony/app/backends/workflow-orchestration/work-item-polling';
import { calculateNumItemsToQueue } from '../app/workers/scheduler';
import env from '../app/util/env';

describe('Scheduler Worker', async function () {
  const service = 'foo:latest';

  describe('processSchedulerQueue', async function () {
    let getPodsCountForServiceStub: SinonStub;
    let getWorkItemsFromDatabaseStub: SinonStub;
    let getSchedulerQueueStub: SinonStub;
    let getQueueUrlForServiceStub: SinonStub;
    let getQueueForUrlStub: SinonStub;
    let getWorkItemUpdateQueueStub: SinonStub;
    const schedulerQueue = new MemoryQueue();
    const workItemUpdateQueue = new MemoryQueue();
    let serviceQueues;

    before(function () {
      getPodsCountForServiceStub = sinon.stub(k8s, 'getPodsCountForService').callsFake(async function () {
        return 1;
      });
      getWorkItemsFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkItemsFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger, _batchSize: number) {
        return [{ workItem: new WorkItem({ id: 1 }) }] as WorkItemData[];
      });
      getSchedulerQueueStub = sinon.stub(qf, 'getWorkSchedulerQueue').callsFake(function () {
        return schedulerQueue;
      });
      getWorkItemUpdateQueueStub = sinon.stub(qf, 'getQueueForType').callsFake(function () {
        return workItemUpdateQueue;
      });
      getQueueUrlForServiceStub = sinon.stub(qf, 'getQueueUrlForService').callsFake(function (serviceID: string) { return serviceID; });
      getQueueForUrlStub = sinon.stub(qf, 'getQueueForUrl').callsFake(function (url: string) {
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
      getWorkItemsFromDatabaseStub.restore();
      getSchedulerQueueStub.restore();
      getQueueForUrlStub.restore();
      getQueueUrlForServiceStub.restore();
      getWorkItemUpdateQueueStub.restore();
    });

    describe('when there is no work on the scheduler queue', async function () {

      beforeEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
        serviceQueues[service] = new MemoryQueue();
        await scheduler.processSchedulerQueue(logger);
      });
      afterEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
      });

      it('does call getSchedulerQueue', async function () {
        expect(getSchedulerQueueStub.called).to.be.true;
      });

      it('does not call getPodsCountForService', async function () {
        expect(getPodsCountForServiceStub.called).to.be.false;
      });

      it('does not call getWorkItemsFromDatabase', async function () {
        expect(getWorkItemsFromDatabaseStub.called).to.be.false;
      });

      it('does not call getQueueForUrl', async function () {
        expect(getQueueForUrlStub.called).to.be.false;
      });

      it('doest not put any messages on the queue', async function () {
        const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
        expect(numMessages).to.equal(0);
      });
    });

    describe('when there is work on the scheduler queue', async function () {

      beforeEach(async function () {
        await schedulerQueue.purge();
        await schedulerQueue.sendMessage(service);
        serviceQueues = {};
        serviceQueues[service] = new MemoryQueue();
        await scheduler.processSchedulerQueue(logger);
      });
      afterEach(async function () {
        await schedulerQueue.purge();
        serviceQueues = {};
      });

      it('calls getPodsCountForService', async function () {
        expect(getPodsCountForServiceStub.called).to.be.true;
      });

      it('calls getWorkItemsFromDatabase', async function () {
        expect(getWorkItemsFromDatabaseStub.called).to.be.true;
      });

      it('calls getSchedulerQueue', async function () {
        expect(getSchedulerQueueStub.called).to.be.true;
      });

      it('calls getQueueForUrl', async function () {
        expect(getQueueForUrlStub.called).to.be.true;
      });

      it('puts messages on the queue', async function () {
        const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
        expect(numMessages).to.equal(1);
      });

      describe('and the work item queue has few items on it', async function () {
        let maxWorkItemsStub;
        beforeEach(async function () {
          await schedulerQueue.purge();
          await schedulerQueue.sendMessage(service);
          serviceQueues = {};
          serviceQueues[service] = new MemoryQueue();
          for (let i = 0; i < 5; i++) {
            await workItemUpdateQueue.sendMessage('foo');
          }
          maxWorkItemsStub = sinon.stub(env, 'maxWorkItemsOnUpdateQueue').get(() => 10);
          await scheduler.processSchedulerQueue(logger, 1);
        });
        afterEach(async function () {
          await schedulerQueue.purge();
          await workItemUpdateQueue.purge();
          serviceQueues = {};
          maxWorkItemsStub.restore();
        });

        it('continues to schedule work', async function () {
          const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
          expect(numMessages).to.equal(1);
        });
      });

      describe('and the work item queue has a large number of work items', async function () {
        let maxWorkItemsStub;
        beforeEach(async function () {
          await schedulerQueue.purge();
          await schedulerQueue.sendMessage(service);
          serviceQueues = {};
          serviceQueues[service] = new MemoryQueue();
          for (let i = 0; i < 6; i++) {
            await workItemUpdateQueue.sendMessage('foo');
          }
          maxWorkItemsStub = sinon.stub(env, 'maxWorkItemsOnUpdateQueue').get(() => 5);
          await scheduler.processSchedulerQueue(logger, 1);
        });
        afterEach(async function () {
          await schedulerQueue.purge();
          await workItemUpdateQueue.purge();
          serviceQueues = {};
          maxWorkItemsStub.restore();
        });

        it('does not schedule any work', async function () {
          const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
          expect(numMessages).to.equal(0);
        });
      });

      describe('and the scheduler is configured to continue queueing with a large number of items', async function () {
        let maxWorkItemsStub;
        beforeEach(async function () {
          await schedulerQueue.purge();
          await schedulerQueue.sendMessage(service);
          serviceQueues = {};
          serviceQueues[service] = new MemoryQueue();
          for (let i = 0; i < 6; i++) {
            await workItemUpdateQueue.sendMessage('foo');
          }
          maxWorkItemsStub = sinon.stub(env, 'maxWorkItemsOnUpdateQueue').get(() => -1);
          await scheduler.processSchedulerQueue(logger, 1);
        });
        afterEach(async function () {
          await schedulerQueue.purge();
          await workItemUpdateQueue.purge();
          serviceQueues = {};
          maxWorkItemsStub.restore();
        });

        it('continues to schedule work', async function () {
          const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
          expect(numMessages).to.equal(1);
        });
      });
    });
  });

  describe('calculateNumItemsToQueue', function () {
    describe('queueing 110% of the number of workers', function () {
      it('queues 110%', function () {
        const actual = calculateNumItemsToQueue(100, 1, 0, 1.1);
        expect(actual).to.equal(110);
      });
    });

    describe('ensures at least one work item is queued even when scaling factor is low and num schedulers high', function () {
      it('queues one item', function () {
        const actual = calculateNumItemsToQueue(1, 100, 0, 0.0001);
        expect(actual).to.equal(1);
      });
    });

    describe('does not queue another item if one is queued and the scaling factor is low and num schedulers high', function () {
      it('queues zero items', function () {
        const actual = calculateNumItemsToQueue(1, 100, 1, 0.0001);
        expect(actual).to.equal(0);
      });
    });

    describe('when there are no messages queued, work schedulers is 1, and scaling factor is 1', function () {
      it('queues the number of workers', function () {
        const actual = calculateNumItemsToQueue(100, 1, 0, 1);
        expect(actual).to.equal(100);
      });
    });

    describe('when there are no messages queued, work schedulers is 2, and scaling factor is 1', function () {
      it('queues half the number of workers', function () {
        const actual = calculateNumItemsToQueue(100, 2, 0, 1);
        expect(actual).to.equal(50);
      });
    });

    describe('when there are no messages queued, work schedulers is 2, and scaling factor is 0.5', function () {
      it('queues one quarter the number of workers', function () {
        const actual = calculateNumItemsToQueue(100, 2, 0, 0.5);
        expect(actual).to.equal(25);
      });
    });

    describe('when there are three messages queued, work schedulers is 2, and scaling factor is 0.5', function () {
      it('queues one quarter the number of workers minus three', function () {
        const actual = calculateNumItemsToQueue(100, 2, 3, 0.5);
        expect(actual).to.equal(22);
      });
    });

    describe('when there are as many items queued as the max allowed messages queued', function () {
      it('queues zero items', function () {
        const actual = calculateNumItemsToQueue(100, 1, 100, 1);
        expect(actual).to.equal(0);
      });
    });

    describe('when there are no messages queued, work schedulers is 4', function () {
      it('queues one quarter the number of workers', function () {
        const actual = calculateNumItemsToQueue(100, 4, 0, 1);
        expect(actual).to.equal(25);
      });
    });

    describe('when there are no service workers running and no messages queued', function () {
      it('will queue exactly one message', function () {
        const actual = calculateNumItemsToQueue(0, 1, 0, 1.1);
        expect(actual).to.equal(1);
      });
    });

    describe('when there are no service workers running and 1 message queued', function () {
      it('queues zero items', function () {
        const actual = calculateNumItemsToQueue(0, 0, 1, 1.1);
        expect(actual).to.equal(0);
      });
    });

    describe('when there are no schedulers running and no messages queued', function () {
      it('treats it as if there is 1 scheduler running', function () {
        const actual = calculateNumItemsToQueue(100, 0, 0, 1);
        expect(actual).to.equal(100);
      });
    });
  });
});

