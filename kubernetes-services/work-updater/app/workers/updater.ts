import { Logger } from 'winston';
import { handleWorkItemUpdate, handleWorkItemUpdateWithJobId } from '../../../../app/backends/workflow-orchestration/work-item-updates';
import WorkItem, { WorkItemEvent, getJobIdForWorkItem } from '../../../../app/models/work-item';
import WorkItemUpdate from '../../../../app/models/work-item-update';
import { default as defaultLogger } from '../../../../app/util/log';
import { WorkItemQueueType } from '../../../../app/util/queue/queue';
import { getQueueForType, getWorkSchedulerQueue } from '../../../../app/util/queue/queue-factory';
import sleep from '../../../../app/util/sleep';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import { eventEmitter } from '../../../../app/events';

type WorkItemUpdateQueueItem = {
  update: WorkItemUpdate,
  operation: object,
};

/**
 * Updates the batch of work items. It is assumed that all the work items belong
 * to the same job. Currently, this function processes the updates sequentially, but it
 * may be changed to process them all at once in the future.
 * @param jobID - ID of the job that the work items belong to
 * @param updates - List of work item updates
 * @param logger - Logger to use
 */
async function handleBatchWorkItemUpdatesWithJobId(jobID: string, updates: WorkItemUpdateQueueItem[], logger: Logger): Promise<void> {
  // process each job's updates
  logger.debug(`Processing ${updates.length} work item updates for job ${jobID}`);
  await Promise.all(updates.map(async (item) => {
    const { update, operation } = item;
    await handleWorkItemUpdateWithJobId(jobID, update, operation, logger);
  }));

}

/**
 * This function processes a batch of work item updates.
 * It first creates a map of jobIDs to updates, then it processes each job's updates.
 * It calls the function handleBatchWorkItemUpdatesWithJobId to handle the updates.
 * @param updates - List of work item updates read from the queue
 * @param logger - Logger to use
 */
export async function handleBatchWorkItemUpdates(
  updates: WorkItemUpdateQueueItem[],
  logger: Logger): Promise<void> {
  logger.debug(`Processing ${updates.length} work item updates`);
  // create a map of jobIDs to updates
  const jobUpdates: Record<string, WorkItemUpdateQueueItem[]> =
    await updates.reduce(async (acc, item) => {
      const { workItemID } = item.update;
      const jobID = await getJobIdForWorkItem(workItemID);
      logger.debug(`Processing work item update for job ${jobID}`);
      const accValue = await acc;
      if (accValue[jobID]) {
        accValue[jobID].push(item);
      } else {
        accValue[jobID] = [item];
      }
      return accValue;
    }, {});
  // process each job's updates
  for (const jobID in jobUpdates) {
    const startTime = Date.now();
    logger.debug(`Processing ${jobUpdates[jobID].length} work item updates for job ${jobID}`);
    await handleBatchWorkItemUpdatesWithJobId(jobID, jobUpdates[jobID], logger);
    const endTime = Date.now();
    logger.debug(`Processing ${jobUpdates[jobID].length} work item updates for job ${jobID} took ${endTime - startTime} ms`);
  }
}

/**
 * This function processes a batch of work item updates from the queue.
 * @param queueType - Type of the queue to read from
 */
export async function batchProcessQueue(queueType: WorkItemQueueType): Promise<void> {
  const queue = getQueueForType(queueType);
  const startTime = Date.now();
  // use a smaller batch size for the large item update queue otherwise use the SQS max batch size
  // of 10
  const largeItemQueueBatchSize = Math.min(env.largeWorkItemUpdateQueueMaxBatchSize, 10);
  const otherQueueBatchSize = 10; // the SQS max batch size
  const queueBatchSize = queueType === WorkItemQueueType.LARGE_ITEM_UPDATE
    ? largeItemQueueBatchSize : otherQueueBatchSize;
  defaultLogger.debug(`Polling queue ${queueType} for ${queueBatchSize} messages`);
  const messages = await queue.getMessages(queueBatchSize);
  if (messages.length < 1) {
    return;
  }

  defaultLogger.debug(`Processing ${messages.length} work item updates from queue`);

  if (queueType === WorkItemQueueType.LARGE_ITEM_UPDATE) {
    // process each message individually
    for (const msg of messages) {
      try {
        const updateItem: WorkItemUpdateQueueItem = JSON.parse(msg.body);
        const { update, operation } = updateItem;
        defaultLogger.debug(`Processing work item update from queue for work item ${update.workItemID} and status ${update.status}`);
        await handleWorkItemUpdate(update, operation, defaultLogger);
      } catch (e) {
        defaultLogger.error(`Error processing work item update from queue: ${e}`);
      }
      try {
        // delete the message from the queue even if there was an error updating the work-item
        // so that we don't keep processing the same message over and over
        await queue.deleteMessage(msg.receipt);
      } catch (e) {
        defaultLogger.error(`Error deleting work item update from queue: ${e}`);
      }
    }
  } else {
    // potentially process all the messages at once. this actually calls `handleBatchWorkItemUpdates`,
    // which processes each job's updates individually right now. this just leaves the possibility
    // open for that function to be updated to process all the updates at once in a more efficient
    // manner. It also allows us to delete all the messages from the queue at once, which is more
    // efficient than deleting them one at a time.
    const updates: WorkItemUpdateQueueItem[] = messages.map((msg) => JSON.parse(msg.body));
    try {
      await handleBatchWorkItemUpdates(updates, defaultLogger);
      // TODO TEST CODE
      // const schedulerQueue = getWorkSchedulerQueue();
      // await schedulerQueue.sendMessage('harmonyservices/service-example:latest');
      // END TEST CODE
    } catch (e) {
      defaultLogger.error(`Error processing work item updates from queue: ${e}`);
    }
    // delete all the messages from the queue at once (slightly more efficient)
    try {
      await queue.deleteMessages(messages.map((msg) => msg.receipt));
    } catch (e) {
      defaultLogger.error(`Error deleting work item updates from queue: ${e}`);
    }
  }
  const endTime = Date.now();
  defaultLogger.debug(`Processed ${messages.length} work item updates from queue in ${endTime - startTime} ms`);
}


export default class Updater implements Worker {
  async start(repeat = true): Promise<void> {
    defaultLogger.debug('Starting updater');
    while (repeat) {
      try {
        await batchProcessQueue(env.workItemUpdateQueueType);
      } catch (e) {
        defaultLogger.error(e);
        await sleep(env.workItemUpdateQueueProcessorDelayAfterErrorSec * 1000);
      }
    }
  }
}
