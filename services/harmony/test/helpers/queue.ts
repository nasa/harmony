import { SinonStub, stub } from 'sinon';
import { Logger } from 'winston';

import { MemoryQueue } from './memory-queue';
import {
  durationBasedPolicy, FairQueueingPolicy, SchedulingContext, slotBasedPolicy,
} from '../../app/backends/workflow-orchestration/fair-queueing-policy';
import * as util from '../../app/backends/workflow-orchestration/util';
import { getWorkItemsFromDatabase, WorkItemData } from '../../app/backends/workflow-orchestration/work-item-polling';
import logger from '../../app/util/log';
import { WorkItemQueueType } from '../../app/util/queue/queue';
import * as qf from '../../app/util/queue/queue-factory';

let serviceQueues;
let typeQueues;

// These test-only simulation functions stand in for the real work-scheduler (which has no pod
// running in unit tests), so there's no env to read the fair queueing settings from - mirror the
// production defaults (services/work-scheduler/env-defaults) directly. The service pod count is
// only used by duration based fair queueing.
const DEFAULT_TEST_SCHEDULING_CONTEXT: Omit<SchedulingContext, 'logger'> = {
  servicePodCount: 1, slowWorkThresholdMs: 600_000, fastLaneReserveFraction: 0.3,
};

// The fair queueing policy and settings used by getWorkFromDatabase - slot based by default, as
// in the work-scheduler (ENABLE_DURATION_BASED_FAIR_QUEUEING=false)
let testPolicy: FairQueueingPolicy = slotBasedPolicy;
let testSchedulingContext = DEFAULT_TEST_SCHEDULING_CONTEXT;

/**
 * Enables duration based fair queueing for getWorkFromDatabase in tests, simulating the given
 * service pod count ("capacity") since there is no real k8s cluster to query, so tests can
 * exercise the fast lane reserve behavior. Reverts to slot based fair queueing when called with
 * no argument.
 *
 * @param servicePodCount - the service pod count to simulate, or undefined to use slot based
 * fair queueing
 */
export function setTestDurationBasedFairQueueing(servicePodCount?: number): void {
  if (servicePodCount === undefined) {
    testPolicy = slotBasedPolicy;
    testSchedulingContext = DEFAULT_TEST_SCHEDULING_CONTEXT;
  } else {
    testPolicy = durationBasedPolicy;
    testSchedulingContext = { ...DEFAULT_TEST_SCHEDULING_CONTEXT, servicePodCount };
  }
}

/**
 * Get a work item from the database for the given service ID, using the real production
 * selection algorithm (getWorkItemsFromDatabase) with a batch size of 1, so tests exercise
 * exactly the same fair-queueing logic as the real work-scheduler.
 *
 * @param serviceID - the id of the service to get work for
 * @param reqLogger - a logger instance
 * @returns A work item from the database for the given service ID
 */
export async function getWorkFromDatabase(serviceID: string, reqLogger: Logger): Promise<WorkItemData | null> {
  const workItems = await getWorkItemsFromDatabase(serviceID, reqLogger, 1, testPolicy, testSchedulingContext);
  return workItems[0] ?? null;
}

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
    if ((util.processSchedulerQueue as SinonStub).restore) {
      (util.processSchedulerQueue as SinonStub).restore();
    }
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
    if ((qf.getQueueForType as SinonStub).restore) {
      (qf.getQueueForType as SinonStub).restore();
    }
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
    if ((qf.getQueueForType as SinonStub).restore) {
      (qf.getQueueForType as SinonStub).restore();
    }
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
    if ((qf.getWorkSchedulerQueue as SinonStub).restore) {
      (qf.getWorkSchedulerQueue as SinonStub).restore();
    }
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
    if ((qf.getQueueUrlForService as SinonStub).restore) {
      (qf.getQueueUrlForService as SinonStub).restore();
    }
  });
}

/**
 * This function resets all the serviceQueues object.
 */
export function resetQueues(): void {
  serviceQueues = {};
  typeQueues = {};
}
