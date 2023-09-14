import { stub, SinonStub } from 'sinon';
import * as qf from '../../app/util/queue/queue-factory';
import * as util from '../../app/backends/workflow-orchestration/util';
import { MemoryQueue } from './memory-queue';
import { Logger } from 'winston';
import logger from '../../app/util/log';
import { getWorkFromDatabase } from '../../app/backends/workflow-orchestration/work-item-polling';
import { WorkItemQueueType } from '../../app/util/queue/queue';

let serviceQueues;
let typeQueues;

/**
 * Process the scheduler queue. This function is only used for tests since they won't have a
 * scheduler pod running. It will read the scheduler queue and send the work items to the
 * appropriate service queues.
 */
async function processSchedulerQueue(reqLogger: Logger): Promise<void> {
  const schedulerQueue = qf.getWorkSchedulerQueue();
  // ten is the max batch size for SQS FIFO queues, but for tests which use a memory queue
  // we'll use -1 to indicate to process all the messages
  const queueItems = await schedulerQueue.getMessages(-1);
  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);
  for (const queueItem of queueItems) {
    const serviceID = queueItem.body;
    reqLogger.debug(`Processing scheduler queue item for service ${serviceID}`);
    const queueUrl = qf.getQueueUrlForService(serviceID);
    const queue = qf.getQueueForUrl(queueUrl);
    if (queue) {
      const workItemData = await getWorkFromDatabase(serviceID, reqLogger);
      if (workItemData) {
        reqLogger.debug(`Sending work item data to queue ${queueUrl}`);
        // must include groupId for FIFO queues, but we don't care about it so just use 'w'
        await queue.sendMessage(JSON.stringify(workItemData), 'w');
      }
    } else {
      logger.error(`No queue found for URL ${queueUrl}`);
    }
    reqLogger.debug('Sending delete message to scheduler queue');
    await schedulerQueue.deleteMessage(queueItem.receipt);
  }

}

/**
 * This function stubs the processSchedulerQueue function for testing purposes
 **/
export function hookProcessSchedulerQueue(): void {
  before(function () {
    stub(util, 'processSchedulerQueue').callsFake(processSchedulerQueue);
  });
  after(function () {
    (util.processSchedulerQueue as SinonStub).restore();
  });
}


/**
 * This function sets up a memory queue and stubs the getQueueForType function for testing purposes.
 */
export function hookGetQueueForType(): void {
  before(function () {
    typeQueues = {};
    stub(qf, 'getQueueForType').callsFake((type: WorkItemQueueType) => {
      if (!typeQueues[type]) {
        typeQueues[type] = new MemoryQueue(type);
      }
      return typeQueues[type];
    });
  });
  after(function () {
    (qf.getQueueForType as SinonStub).restore();
    typeQueues = {};
  });
}

/**
 * This function sets up a memory queue and stubs the getQueueForUrl function for testing purposes.
 */
export function hookGetQueueForUrl(): void {
  before(function () {
    serviceQueues = {};
    stub(qf, 'getQueueForUrl').callsFake((url) => {
      if (!serviceQueues[url]) {
        serviceQueues[url] = new MemoryQueue();
      }
      return serviceQueues[url];
    });
  });
  after(function () {
    (qf.getQueueForUrl as SinonStub).restore();
    serviceQueues = {};
  });
}

/**
 * This function sets up a memory queue and stubs the getWorkSchedulerQueue function for testing
 * purposes.
 */
export function hookGetWorkSchedulerQueue(): void {
  before(function () {
    this.schedulerQueue = new MemoryQueue();
    stub(qf, 'getWorkSchedulerQueue').callsFake(() => this.schedulerQueue);
  });
  after(function () {
    (qf.getWorkSchedulerQueue as SinonStub).restore();
  });
}

/**
 * This function stubs the getQueueUrlForService function for testing purposes. It returns a fake
 * URL for the given service.
 */
export function hookGetQueueUrlForService(): void {
  before(function () {
    stub(qf, 'getQueueUrlForService').callsFake((service) => `${service}-url`);
  });
  after(function () {
    (qf.getQueueUrlForService as SinonStub).restore();
  });
}

/**
 * This function resets all the serviceQueues object.
 */
export function resetQueues(): void {
  serviceQueues = {};
  typeQueues = {};
}