import { SinonStub, stub } from 'sinon';
import { Logger } from 'winston';

import { MemoryQueue } from './memory-queue';
import * as util from '../../app/backends/workflow-orchestration/util';
import { WorkItemData } from '../../app/backends/workflow-orchestration/work-item-polling';
import { getNextJobIdForUsernameAndService, getNextUsernameForWork, incrementRunningAndDecrementReadyCounts, recalculateCounts } from '../../app/models/user-work';
import { getNextWorkItem } from '../../app/models/work-item';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { WorkItemQueueType } from '../../app/util/queue/queue';
import * as qf from '../../app/util/queue/queue-factory';

let serviceQueues;
let typeQueues;

/**
 * Get a work item from the database for the given service ID.
 *
 * @param serviceID - the id of the service to get work for
 * @param reqLogger - a logger instance
 * @returns A work item from the database for the given service ID
 */
export async function getWorkFromDatabase(serviceID: string, reqLogger: Logger): Promise<WorkItemData | null> {
  let result: WorkItemData | null = null;
  try {
    await db.transaction(async (tx) => {
      const username = await getNextUsernameForWork(tx, serviceID as string);
      if (username) {
        const jobID = await getNextJobIdForUsernameAndService(tx, serviceID as string, username);
        if (jobID) {
          const workItem = await getNextWorkItem(tx, serviceID as string, jobID);
          if (workItem) {
            await incrementRunningAndDecrementReadyCounts(tx, jobID, serviceID as string);

            if (workItem && util.QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
              const childLogger = reqLogger.child({ workItemId: workItem.id });
              const maxCmrGranules = await util.calculateQueryCmrLimit(tx, workItem, childLogger);
              reqLogger.debug(`Found work item ${workItem.id} for service ${serviceID} with max CMR granules ${maxCmrGranules}`);
              result = { workItem, maxCmrGranules };
            } else {
              result = { workItem };
            }
          } else {
            reqLogger.warn(`user_work is out of sync for user ${username} and job ${jobID}, could not find ready work item`);
            reqLogger.warn(`recalculating ready and running counts for job ${jobID}`);
            await recalculateCounts(tx, jobID);
          }
        }
      }
    });
  } catch (err) {
    reqLogger.error(`Error getting work from database: ${err.message}`);
  }
  return result;
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
