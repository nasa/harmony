import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { Logger } from 'winston';

import * as workItemPolling from '../../harmony/app/backends/workflow-orchestration/work-item-polling';
import * as userWorkModel from '../../harmony/app/models/user-work';
import WorkItem from '../../harmony/app/models/work-item';
import * as workItemModel from '../../harmony/app/models/work-item';
import db from '../../harmony/app/util/db';
import logger from '../../harmony/app/util/log';
import * as queueFactory from '../../harmony/app/util/queue/queue-factory';
import { MemoryQueue } from '../../harmony/test/helpers/memory-queue';
import env from '../app/util/env';
import * as k8s from '../app/util/k8s';
import { calculateNumItemsToQueue, processSchedulerQueue } from '../app/workers/scheduler';

describe('Scheduler Worker', async function () {
  const service = 'foo:latest';

  describe('processSchedulerQueue', async function () {
    let getPodsCountForServiceStub: sinon.SinonStub;
    let getWorkItemsFromDatabaseStub: sinon.SinonStub;
    let getSchedulerQueueStub: sinon.SinonStub;
    let getQueueUrlForServiceStub: sinon.SinonStub;
    let getQueueForUrlStub: sinon.SinonStub;
    let getWorkItemUpdateQueueStub: sinon.SinonStub;
    const schedulerQueue = new MemoryQueue();
    const workItemUpdateQueue = new MemoryQueue();
    let serviceQueues;

    before(function () {
      getPodsCountForServiceStub = sinon.stub(k8s, 'getPodsCountForService').callsFake(async function () {
        return 1;
      });
      getWorkItemsFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkItemsFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger, _batchSize: number) {
        return [{ workItem: new WorkItem({ id: 1 }) }] as workItemPolling.WorkItemData[];
      });
      getSchedulerQueueStub = sinon.stub(queueFactory, 'getWorkSchedulerQueue').callsFake(function () {
        return schedulerQueue;
      });
      getWorkItemUpdateQueueStub = sinon.stub(queueFactory, 'getQueueForType').callsFake(function () {
        return workItemUpdateQueue;
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
        await processSchedulerQueue(logger);
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
        await processSchedulerQueue(logger);
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
          await processSchedulerQueue(logger, 1);
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
          await processSchedulerQueue(logger, 1);
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
          await processSchedulerQueue(logger, 1);
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
    describe('low queue scenario (queuedCount <= 10% of servicePodCount)', function () {
      describe('when queue is empty and pods are starved', function () {
        it('queues based on the scaled capacity', function () {
          const actual = calculateNumItemsToQueue(100, 1, 0, 1.1);
          // fullQueueCount = 100 - 0 = 100
          // Math.floor(100 * 1.1) = 110
          // Math.max(1, 110) = 110
          expect(actual).to.equal(110);
        });

        it('queues at least 1 item even if scaled capacity evaluates to 0', function () {
          const actual = calculateNumItemsToQueue(100, 1, 0, 0);
          // fullQueueCount = 100 - 0 = 100
          // Math.floor(100 * 0) = 0
          // Math.max(1, 0) = 1
          expect(actual).to.equal(1);
        });
      });

      describe('when queue has some items but still below threshold', function () {
        it('accounts for already queued items when calculating scaled capacity', function () {
          const actual = calculateNumItemsToQueue(100, 1, 5, 1.1);
          // fullQueueCount = 100 - 5 = 95
          // 95 * 1.1 = 104.50000000000001
          // Math.floor(104.50000000000001) = 104
          // Math.max(1, 104) = 104
          expect(actual).to.equal(104);
        });

        it('reduces scaled capacity properly as queue fills up', function () {
          const actual = calculateNumItemsToQueue(100, 1, 8, 1.1);
          // fullQueueCount = 100 - 8 = 92
          // Math.floor(92 * 1.1) = 101
          // Math.max(1, 101) = 101
          expect(actual).to.equal(101);
        });
      });

      describe('edge case: exactly at 10% threshold', function () {
        it('triggers low queue logic with scale factor', function () {
          const actual = calculateNumItemsToQueue(100, 1, 10, 1.1);
          // 10 <= 0.1 * 100 is true (Low queue logic)
          // fullQueueCount = 100 - 10 = 90
          // Math.floor(90 * 1.1) = 99
          // Math.max(1, 99) = 99
          expect(actual).to.equal(99);
        });
      });
    });

    describe('normal scenario (queuedCount > 10% of servicePodCount)', function () {
      describe('basic scale factor calculations', function () {
        it('queues to reach target with scale factor 1.1 and 1 scheduler', function () {
          const actual = calculateNumItemsToQueue(100, 1, 20, 1.1);
          // 1.1 * (100 / 1) - 20 = 110 - 20 = 90
          expect(actual).to.equal(90);
        });

        it('accounts for queueing based on multiple schedulers', function () {
          const actual = calculateNumItemsToQueue(100, 2, 20, 1);
          // 1 * (100 / 2) - 20 = 50 - 20 = 30
          expect(actual).to.equal(30);
        });

        it('applies scale factor with multiple schedulers', function () {
          const actual = calculateNumItemsToQueue(100, 2, 20, 0.5);
          // 0.5 * (100 / 2) - 20 = 25 - 20 = 5
          expect(actual).to.equal(5);
        });

        it('queues nothing when already at target', function () {
          const actual = calculateNumItemsToQueue(100, 1, 110, 1.1);
          // 1.1 * (100 / 1) - 110 = 0
          expect(actual).to.equal(0);
        });

        it('queues nothing when over target', function () {
          const actual = calculateNumItemsToQueue(100, 1, 150, 1.1);
          // 1.1 * (100 / 1) - 150 = -40, floored to 0
          expect(actual).to.equal(0);
        });
      });

      describe('fractional results are floored', function () {
        it('floors to integer', function () {
          const actual = calculateNumItemsToQueue(100, 3, 20, 1);
          // 1 * (100 / 3) - 20 = 33.33... - 20 = 13.33..., floored to 13
          expect(actual).to.equal(13);
        });
      });

      describe('edge case: prevents perpetual zero queueing', function () {
        it('queues 1 item when calculation is zero and queue is empty', function () {
          const actual = calculateNumItemsToQueue(1, 100, 0, 0.0001);
          // 0 <= 0.1 * 1 = 0.1 is TRUE, so low queue logic applies
          // fullQueueCount = 1 - 0 = 1
          // Math.floor(1 * 0.0001) = 0
          // Math.max(1, 0) = 1
          expect(actual).to.equal(1);
        });

        it('queues nothing when calculation is zero but queue has items', function () {
          const actual = calculateNumItemsToQueue(1, 100, 1, 0.0001);
          // 1 <= 0.1 * 1 = 0.1 is FALSE, so normal logic
          // 0.0001 * (1 / 100) - 1 = 0.000001 - 1 = negative, floored to 0
          // queuedCount > 0, so stays 0
          expect(actual).to.equal(0);
        });
      });
    });

    describe('zero scheduler pod count handling', function () {
      it('treats zero schedulers as one scheduler', function () {
        const actual = calculateNumItemsToQueue(100, 0, 20, 1);
        // max(1, 0) = 1
        // 1 * (100 / 1) - 20 = 80
        expect(actual).to.equal(80);
      });
    });

    describe('zero service pod count', function () {
      it('queues 1 when no pods and empty queue', function () {
        const actual = calculateNumItemsToQueue(0, 1, 0, 1.1);
        // 0 <= 0.1 * 0 is TRUE, so low queue logic
        // fullQueueCount = 0 - 0 = 0
        // Math.floor(0 * 1.1) = 0
        // Math.max(1, 0) = 1
        expect(actual).to.equal(1);
      });

      it('queues nothing when no pods but queue has items', function () {
        const actual = calculateNumItemsToQueue(0, 1, 1, 1.1);
        // 1 <= 0.1 * 0 = 0 is FALSE, so normal logic
        // 1.1 * (0 / 1) - 1 = -1, floored to 0
        expect(actual).to.equal(0);
      });
    });
  });
});

describe('getWorkItemsFromDatabase', function () {
  const serviceID = 'foo:latest';
  const batchSize = 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeTx = {} as any;
  const sandbox = sinon.createSandbox();

  let getNextJobIdsStub: sinon.SinonStub;
  let getNextWorkItemsStub: sinon.SinonStub;
  let setReadyCountToZeroStub: sinon.SinonStub;
  let incrementRunningStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox.stub(db, 'transaction').callsFake(async (cb) => cb(fakeTx));
    getNextJobIdsStub = sandbox.stub(userWorkModel, 'getNextJobIds');
    getNextWorkItemsStub = sandbox.stub(workItemModel, 'getNextWorkItems');
    setReadyCountToZeroStub = sandbox.stub(userWorkModel, 'setReadyCountToZero').resolves();
    incrementRunningStub = sandbox.stub(userWorkModel, 'incrementRunningAndDecrementReadyCounts').resolves();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('when user_work reports a ready job but no ready work items exist', function () {
    let result;
    beforeEach(async function () {
      getNextJobIdsStub.resolves(['job-1']);
      getNextWorkItemsStub.resolves([]); // out of sync -> else branch
      result = await workItemPolling.getWorkItemsFromDatabase(serviceID, logger, batchSize);
    });

    it('calls setReadyCountToZero exactly once', function () {
      expect(setReadyCountToZeroStub.calledOnce).to.be.true;
    });

    it('passes the stale jobID and serviceID to setReadyCountToZero', function () {
      const [, jobIdArg, serviceIdArg] = setReadyCountToZeroStub.firstCall.args;
      expect(jobIdArg).to.equal('job-1');
      expect(serviceIdArg).to.equal(serviceID);
    });

    it('does not increment running / decrement ready counts', function () {
      expect(incrementRunningStub.called).to.be.false;
    });

    it('returns no work items', function () {
      expect(result).to.deep.equal([]);
    });
  });

  describe('when ready work items exist', function () {
    beforeEach(async function () {
      getNextJobIdsStub.resolves(['job-1']);
      getNextWorkItemsStub.resolves([new WorkItem({ id: 1, jobID: 'job-1', serviceID })]);
      await workItemPolling.getWorkItemsFromDatabase(serviceID, logger, batchSize);
    });

    it('does not call setReadyCountToZero', function () {
      expect(setReadyCountToZeroStub.called).to.be.false;
    });

    it('increments running and decrements ready counts instead', function () {
      expect(incrementRunningStub.calledOnce).to.be.true;
    });
  });

  describe('with multiple jobs where only one is out of sync', function () {
    beforeEach(async function () {
      getNextJobIdsStub.resolves(['job-ok', 'job-stale']);
      getNextWorkItemsStub
        .withArgs(fakeTx, serviceID, 'job-ok', sinon.match.number)
        .resolves([new WorkItem({ id: 1, jobID: 'job-ok', serviceID })]);
      getNextWorkItemsStub
        .withArgs(fakeTx, serviceID, 'job-stale', sinon.match.number)
        .resolves([]);
      await workItemPolling.getWorkItemsFromDatabase(serviceID, logger, batchSize);
    });

    it('zeroes the ready count only for the stale job', function () {
      expect(setReadyCountToZeroStub.calledOnce).to.be.true;
      expect(setReadyCountToZeroStub.firstCall.args[1]).to.equal('job-stale');
    });

    it('increments counts only for the job with ready work', function () {
      expect(incrementRunningStub.calledOnce).to.be.true;
      expect(incrementRunningStub.firstCall.args[1]).to.equal('job-ok');
    });
  });
});

