import { Logger } from 'winston';

import { getFairQueueingPolicy } from './fair-queueing-policy';
import { calculateQueryCmrLimit, processSchedulerQueue, QUERY_CMR_SERVICE_REGEX } from './util';
import {
  DurationBasedFairQueueingOptions, incrementReadyAndDecrementRunningCounts, incrementRunningAndDecrementReadyCounts,
  setReadyCountToZero,
} from '../../models/user-work';
import WorkItem, {
  getNextWorkItems, getWorkItemStatus, updateWorkItemStatuses,
} from '../../models/work-item';
import { WorkItemStatus } from '../../models/work-item-interface';
import WorkflowStep from '../../models/workflow-steps';
import { Cache } from '../../util/cache/cache';
import { MemoryCache } from '../../util/cache/memory-cache';
import db from '../../util/db';
import logger from '../../util/log';
import {
  getQueueForUrl, getQueueUrlForService, getWorkSchedulerQueue,
} from '../../util/queue/queue-factory';

export type WorkItemData = {
  workItem: WorkItem,
  maxCmrGranules?: number
};


/**
 * Function to fetch the operation for a work-item when it is not in the cache
 *
 * @param key - comma-separated combination of job ID and service ID
 * @returns The data operation JSON string read from the database
*/
async function operationFetcher(key: string): Promise<string> {
  let result = undefined;
  const [jobID, serviceID] = key.split(',');
  await db.transaction(async (tx) => {
    try {
      const workflowStepData = await tx(WorkflowStep.table)
        .select(['operation'])
        .where('jobID', '=', jobID)
        .andWhere({ serviceID })
        .first();
      result = workflowStepData.operation;
    } catch (err) {
      logger.error(`Error getting operation of jobID: ${jobID} and serviceID: ${serviceID} from database: ${err.message}`);
    }
  });

  return result;
}

const operationCache: Cache = new MemoryCache(operationFetcher);

/**
 * Get work items from the database for the given service ID. Which jobs the work items come
 * from is decided by the active fair queueing policy (see fair-queueing-policy.ts).
 *
 * @param serviceID - the id of the service to get work for
 * @param reqLogger - a logger instance
 * @param batchSize - the maximum number of work items to return
 * @param durationBasedOptions - settings for duration based fair queueing (including the service
 * pod count used to limit how many work items for slow jobs may be running at once), or undefined
 * to use slot based fair queueing
 * @param servicePodCount - the number of pods currently running the service, if known
 * @returns work items from the database for the given service ID
 */
export async function getWorkItemsFromDatabase(
  serviceID: string,
  reqLogger: Logger,
  batchSize: number,
  durationBasedOptions?: DurationBasedFairQueueingOptions,
  servicePodCount?: number,
): Promise<WorkItemData[]> {
  const workItems: WorkItemData[] = [];
  try {
    await db.transaction(async (tx) => {
      const takeWorkItems = async (jobId: string, workSize: number): Promise<number> => {
        const nextWorkItems = await getNextWorkItems(tx, serviceID, jobId, workSize);

        if (nextWorkItems?.length > 0) {
          for (const workItem of nextWorkItems) {
            if (workItem && QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
              const childLogger = reqLogger.child({ workItemId: workItem.id });
              const maxCmrGranules = await calculateQueryCmrLimit(tx, workItem, childLogger);
              reqLogger.debug(`Found work item ${workItem.id} for service ${serviceID} with max CMR granules ${maxCmrGranules}`);

              workItems.push({ workItem, maxCmrGranules });
            } else {
              workItems.push({ workItem });
            }
          }

          await incrementRunningAndDecrementReadyCounts(tx, jobId, serviceID, nextWorkItems.length);
        } else {
          reqLogger.warn(`user_work is out of sync for job ${jobId} and service ${serviceID}, could not find ready work item`);
          await setReadyCountToZero(tx, jobId, serviceID);
        }

        return nextWorkItems?.length ?? 0;
      };

      await getFairQueueingPolicy().scheduleWork(
        tx, serviceID, batchSize, { logger: reqLogger, servicePodCount, durationBasedOptions }, takeWorkItems);
    });
  } catch (err) {
    reqLogger.error(err);
    reqLogger.error(`Error getting works from database: ${err.message}`);
  }

  return workItems;
}

/**
 * Reverts work items that were pulled out of the `ready` state (and counted as `running` in
 * `user_work`) but failed to actually be sent to their service's SQS queue, so they aren't
 * orphaned as `queued` forever - invisible to any pod's poll and permanently occupying a
 * `running_count` slot - until `work-failer`'s timeout eventually notices them. Only items still
 * in the `queued` state are reverted (and counted), since a concurrent cancellation could have
 * already moved an item out of `queued` - unconditionally reverting it would resurrect a
 * canceled item and make it eligible for scheduling again.
 * @param workItems - the work items to revert back to `ready`
 * @param reqLogger - the logger to use
 * @throws if the revert fails, so the caller doesn't treat these items as handled
 */
export async function revertQueuedWorkItemsToReady(
  workItems: WorkItemData[],
  reqLogger: Logger,
): Promise<void> {
  if (workItems.length < 1) return;
  try {
    await db.transaction(async (tx) => {
      const stillQueued = await tx(WorkItem.table)
        .select('id', 'jobID', 'serviceID')
        .where('status', WorkItemStatus.QUEUED)
        .whereIn('id', workItems.map(({ workItem }) => workItem.id));
      if (stillQueued.length < 1) return;
      await updateWorkItemStatuses(tx, stillQueued.map((item) => item.id), WorkItemStatus.READY);
      for (const item of stillQueued) {
        await incrementReadyAndDecrementRunningCounts(tx, item.jobID, item.serviceID);
      }
    });
  } catch (err) {
    reqLogger.error(`Error reverting work items ${workItems.map(({ workItem }) => workItem.id)} back to ready after failing to queue them: ${err.message}`);
    reqLogger.error(err);
    throw err;
  }
}

/**
 *  Put a message on the work scheduler queue asking it to schedule some WorkItems for the given
 *  service
 * @param serviceID - The service ID for which to request work
 */
export async function makeWorkScheduleRequest(serviceID: string): Promise<void> {
  const schedulerQueue = getWorkSchedulerQueue();
  await schedulerQueue.sendMessage(serviceID);
}

/**
 * Get the next work item for the given service from the queue
 * @param serviceID - The service ID for which to get work
 */
export async function getWorkFromQueue(serviceID: string, reqLogger: Logger): Promise<WorkItemData | null> {
  const queueUrl = getQueueUrlForService(serviceID);
  reqLogger.silly(`Short polling for work from queue ${queueUrl} for service ${serviceID}`);

  const queue = getQueueForUrl(queueUrl);
  if (!queue) {
    throw new Error(`No queue found for URL ${queueUrl}`);
  }

  // get a message from the service queue without using long-polling
  let queueItem = await queue.getMessage(0);
  if (!queueItem) {
    reqLogger.silly(`No work found on queue ${queueUrl} for service ${serviceID} - requesting work from scheduler`);
    // put a message on the scheduler queue asking it to schedule some WorkItems for this service
    await makeWorkScheduleRequest(serviceID);

    // this actually does nothing outside of tests since the scheduler pod will be running
    await processSchedulerQueue(reqLogger);

    // long poll for work before giving up
    reqLogger.silly(`Long polling for work on queue ${queueUrl} for service ${serviceID}`);
    queueItem = await queue.getMessage();
  }

  if (queueItem) {
    reqLogger.debug(`Found work item on queue ${queueUrl}`);
    // normally we would process this before deleting the message, but we instead are relying on
    // our retry mechanism to requeue the message if the worker fails
    await queue.deleteMessage(queueItem.receipt);
    reqLogger.debug(`Deleted work item with receipt ${queueItem.receipt} from queue ${queueUrl}`);
    const item = JSON.parse(queueItem.body) as WorkItemData;

    const operationKey = `${item.workItem.jobID},${item.workItem.serviceID}`;
    let operationJson;
    // always fetch for query-cmr service to make sure the update to operation
    // for removing the extraArgs used for granule validation is picked up
    if (QUERY_CMR_SERVICE_REGEX.test(item.workItem.serviceID)) {
      operationJson = await operationFetcher(operationKey);
    } else {
      operationJson = await operationCache.fetch(operationKey);
    }

    if (operationJson) {
      const operation = JSON.parse(operationJson);
      // Make sure that the staging location is unique for every work item in a job
      // in case a service for the same job produces an output with the same file name
      operation.stagingLocation += `${item.workItem.id}/`;
      item.workItem.operation = operation;
    }

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
    reqLogger.silly(`No work found on queue ${queueUrl} for service ${serviceID}`);
  }

  return null;
}

