import db from '../../util/db';
import { Logger } from 'winston';
import logger from '../../util/log';
import env from '../../util/env';
import WorkItem, { getNextWorkItem, updateWorkItemStatuses, WorkItemEvent } from '../../models/work-item';
import { getNextJobIdForUsernameAndService, getNextUsernameForWork, incrementRunningAndDecrementReadyCounts } from '../../models/user-work';
import { getQueueForUrl, getQueueUrlForService, getWorkSchedulerQueue  } from '../../util/queue/queue-factory';
import { QUERY_CMR_SERVICE_REGEX, calculateQueryCmrLimit } from './util';
import { eventEmitter } from '../../events';
import { WorkItemStatus } from '../../models/work-item-interface';

export type WorkItemData = {
  workItem: WorkItem,
  maxCmrGranules?: number
};

/**
 * Get a work item from the database for the given service ID.
 *
 * @param serviceID - the id of the service to get work for
 * @param reqLogger - a logger instance
 * @returns A work item from the database for the given service ID
 */
export async function getWorkFromDatabase(serviceID: string, reqLogger: Logger): Promise<WorkItemData> {
  let result: WorkItemData;
  try {
    await db.transaction(async (tx) => {
      const username = await getNextUsernameForWork(tx, serviceID as string);
      if (username) {
        const jobID = await getNextJobIdForUsernameAndService(tx, serviceID as string, username);
        if (jobID) {
          const workItem = await getNextWorkItem(tx, serviceID as string, jobID);
          if (workItem) {
            await incrementRunningAndDecrementReadyCounts(tx, jobID, serviceID as string);

            if (workItem && QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
              const childLogger = reqLogger.child({ workItemId: workItem.id });
              const maxCmrGranules = await calculateQueryCmrLimit(tx, workItem, childLogger);
              reqLogger.debug(`Found work item ${workItem.id} for service ${serviceID} with max CMR granules ${maxCmrGranules}`);
              result = { workItem, maxCmrGranules };
            } else {
              result = { workItem };
            }
          } else {
            reqLogger.warn(`user_work is out of sync for user ${username} and job ${jobID}, could not find ready work item`);
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
 * Temporary code to process the work scheduler queue until we move this to a worker. This is
 * just a temporary solution to get the work scheduler working for testing. It should not be
 * used in production as it does not limit the number of items it will put on a service queue,
 * which will break fair queueing. It also only processes one item at a time, which is not
 * efficient. The actual scheduler will be implemented in HARMONY-1419.
 */
export async function processSchedulerQueue(reqLogger: Logger): Promise<void> {
  const schedulerQueue = getWorkSchedulerQueue();
  // ten is the max batch size for SQS FIFO queues
  const queueItems = await schedulerQueue.getMessages(10);
  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);
  for (const queueItem of queueItems) {
    const serviceID = queueItem.body;
    reqLogger.debug(`Processing scheduler queue item for service ${serviceID}`);
    const queueUrl = getQueueUrlForService(serviceID);
    const queue = getQueueForUrl(queueUrl);
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
 *  Put a message on the work scheduler queue asking it to schedule some WorkItems for the given
 *  service
 * @param serviceID - The service ID for which to request work
 */
export async function requestWorkScheduler(serviceID: string): Promise<void> {
  const schedulerQueue = getWorkSchedulerQueue();
  await schedulerQueue.sendMessage(serviceID, 'w');
}

/**
 * Get the next work item for the given service from the queue
 * @param serviceID - The service ID for which to get work
 */
export async function getWorkFromQueue(serviceID: string, reqLogger: Logger): Promise<WorkItemData> {
  const queueUrl = getQueueUrlForService(serviceID);
  reqLogger.debug(`Short polling for work from queue ${queueUrl} for service ${serviceID}`);

  const queue = getQueueForUrl(queueUrl);
  if (!queue) {
    throw new Error(`No queue found for URL ${queueUrl}`);
  }

  // get a message from the service queue without using long-polling
  let queueItem = await queue.getMessage(0);
  if (!queueItem) {
    reqLogger.debug(`No work found on queue ${queueUrl} for service ${serviceID} - requesting work from scheduler`);
    // put a message on the scheduler queue asking it to schedule some WorkItems for this service
    const schedulerQueue = getWorkSchedulerQueue();
    // must include groupId for FIFO queues, but we don't care about it so just use 'w'
    await schedulerQueue.sendMessage(serviceID, 'w');

    // process the scheduler queue to schedule some work for this service - this is temporary
    // until the actual scheduler is implemented
    await processSchedulerQueue(reqLogger);

    // long poll for work before giving up
    reqLogger.debug(`Long polling for work on queue ${queueUrl} for service ${serviceID}`);
    queueItem = await queue.getMessage();
  }

  if (queueItem){
    // reqLogger.debug(`Found work item ${JSON.stringify(queueItem, null, 2)} on queue ${queueUrl}`);
    reqLogger.debug(`Found work item on queue ${queueUrl}`);
    // normally we would process this before deleting the message, but we instead are relying on
    // our retry mechanism to requeue the message if the worker fails
    await queue.deleteMessage(queueItem.receipt);
    reqLogger.debug(`Deleted work item with receipt ${queueItem.receipt} from queue ${queueUrl}`);
    const item = JSON.parse(queueItem.body) as WorkItemData;
    // set the status to running
    try {
      await db.transaction(async (tx) => {
        await updateWorkItemStatuses(tx, [item.workItem.id], WorkItemStatus.RUNNING);
      });
      return item;
    } catch (err) {
      reqLogger.error(`Error updating work item status to running: ${err.message}`);
    }
  } else {
    reqLogger.debug(`No work found on queue ${queueUrl} for service ${serviceID}`);
  }

  return null;
}

// Listen for work items being created and put a message on the scheduler queue asking it to
// schedule some WorkItems for the service
eventEmitter.on(WorkItemEvent.CREATED, async (workItem: WorkItem) => {
  if (env.useServiceQueues) {
    const defaultLogger = logger.child({ application: 'work-scheduler' });
    const { serviceID } = workItem;
    defaultLogger.debug(`Work item created for service ${serviceID}, putting message on scheduler queue`);
    const queue = getWorkSchedulerQueue();
    // must include groupId for FIFO queues, but we don't care about it so just use 'w'
    await queue.sendMessage(serviceID, 'w');
    // temporary code to process the scheduler queue until we move this to a worker
    await processSchedulerQueue(defaultLogger);
  }
});