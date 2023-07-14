import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import { Logger } from 'winston';
import * as scheduler from '../app/workers/updater';
import * as workItemPolling from '../../../app/backends/workflow-orchestration/work-item-polling';
import * as queueFactory from '../../../app/util/queue/queue-factory';
import logger from '../../../app/util/log';
import { MemoryQueue } from '../../../test/helpers/memory-queue';
import WorkItem from '../../../app/models/work-item';
import { WorkItemData } from '../../../app/backends/workflow-orchestration/work-item-polling';

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

