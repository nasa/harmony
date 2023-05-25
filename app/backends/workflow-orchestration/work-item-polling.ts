import db from '../../util/db';
import { Logger } from 'winston';
import logger from '../../util/log';
import env from '../../util/env';
import WorkItem, { getNextWorkItem, getWorkItemStatus, updateWorkItemStatuses, WorkItemEvent } from '../../models/work-item';
import { getNextJobIdForUsernameAndService, getNextUsernameForWork, incrementRunningAndDecrementReadyCounts, recalculateCounts } from '../../models/user-work';
import { getQueueForUrl, getQueueUrlForService, getWorkSchedulerQueue  } from '../../util/queue/queue-factory';
import { QUERY_CMR_SERVICE_REGEX, calculateQueryCmrLimit, processSchedulerQueue } from './util';
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
 *  Put a message on the work scheduler queue asking it to schedule some WorkItems for the given
 *  service
 * @param serviceID - The service ID for which to request work
 */
export async function requestWorkScheduler(serviceID: string): Promise<void> {
  const schedulerQueue = getWorkSchedulerQueue();
  // must include groupId for FIFO queues, but we don't care about it so just use 'w'
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
    await requestWorkScheduler(serviceID);

    // this actually does nothing outside of tests since the scheduler pod will be running
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
    // make sure the item wasn't canceled and set the status to running
    try {
      await db.transaction(async (tx) => {
        const currentStatus = await getWorkItemStatus(tx, item.workItem.id);
        if (currentStatus === WorkItemStatus.CANCELED) {
          reqLogger.debug(`Work item ${item.workItem.id} was canceled, skipping`);
          return null;
        } else {
          await updateWorkItemStatuses(tx, [item.workItem.id], WorkItemStatus.RUNNING);
        }
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
    // this actually does nothing outside of tests since the scheduler pod will be running
    await processSchedulerQueue(defaultLogger);
  }
});
