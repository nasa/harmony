import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as scheduler from '../app/workers/scheduler';
import * as k8s from '../app/util/k8s';
import * as workItemPolling from '../../../app/backends/workflow-orchestration/work-item-polling';
import * as queueFactory from '../../../app/util/queue/queue-factory';
import { MemoryQueue } from '../../../test/helpers/memory-queue';
import WorkItem from '../../../app/models/work-item';
import { WorkItemData } from '../../../app/backends/workflow-orchestration/work-item-polling';
import env from '../app/util/env';

describe('Scheduler Worker', async function () {
  const service = 'foo:latest';

  describe('schedule work', async function () {
    let getPodsCountForServiceStub: SinonStub;
    let getWorkFromDatabaseStub: SinonStub;
    let getQueueUrlForServiceStub: SinonStub;
    let getQueueForUrlStub: SinonStub;
    let serviceQueues;

    before(function () {
      env.serviceQueueUrls = {
        'foo:latest': 'foo',
      };
      getPodsCountForServiceStub = sinon.stub(k8s, 'getPodsCountForService').callsFake(async function () {
        return 1;
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
      getQueueForUrlStub.restore();
      getQueueUrlForServiceStub.restore();
    });

    beforeEach(async function () {
      serviceQueues = {};
      serviceQueues[service] = new MemoryQueue();
      await scheduler.updateServiceQueues();
    });
    afterEach(async function () {
      serviceQueues = {};
    });

    describe('when there is no work for a service', async function () {
      before(function () {
        getWorkFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger) {
          return null;
        });
      });

      after(function () {
        getWorkFromDatabaseStub.restore();
      });

      it('calls getPodsCountForService', async function () {
        expect(getPodsCountForServiceStub.called).to.be.true;
      });

      it('calls getWorkFromDatabase', async function () {
        expect(getWorkFromDatabaseStub.called).to.be.true;
      });

      it('calls getQueueForUrl', async function () {
        expect(getQueueForUrlStub.called).to.be.true;
      });

      it('does not put a message on the queue', async function () {
        const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
        expect(numMessages).to.equal(0);
      });
    });

    describe('when there is work for a service', async function () {
      before(function () {
        getWorkFromDatabaseStub = sinon.stub(workItemPolling, 'getWorkFromDatabase').callsFake(async function (_serviceID: string, _logger: Logger) {
          return { workItem: new WorkItem({ id: 1 }) } as WorkItemData;
        });
      });

      after(function () {
        getWorkFromDatabaseStub.restore();
      });

      it('calls getPodsCountForService', async function () {
        expect(getPodsCountForServiceStub.called).to.be.true;
      });

      it('calls getWorkFromDatabase', async function () {
        expect(getWorkFromDatabaseStub.called).to.be.true;
      });

      it('calls getQueueForUrl', async function () {
        expect(getQueueForUrlStub.called).to.be.true;
      });

      it('puts messages on the queue', async function () {
        const numMessages = await serviceQueues[service].getApproximateNumberOfMessages();
        expect(numMessages).to.equal(1);
      });
    });
  });
});

