import { Logger } from 'winston';
import {
  WorkItemUpdateQueueItem,
  handleWorkItemUpdate,
  preprocessWorkItem,
  processWorkItems } from '@harmony/harmony/app/backends/workflow-orchestration/work-item-updates';
import { getJobIdForWorkItem } from '@harmony/harmony/app/models/work-item';
import { default as defaultLogger } from '@harmony/harmony/app/util/log';
import { WorkItemQueueType } from '@harmony/util/queue';
import { queuefactory as qf } from '@harmony/util';
import sleep from '@harmony/harmony/app/util/sleep';
import { Worker } from '@harmony/harmony/app/workers/worker';
import env from '../util/env';
import { logAsyncExecutionTime } from '../../../harmony/app/util/log-execution';
import { getWorkflowStepByJobIdStepIndex } from '../../../harmony/app/models/workflow-steps';
import db from '../../../harmony/app/util/db';

/**
 * Group work item updates by its workflow step and return the grouped work item updates
 * as a map of workflow step to a list of work item updates on that workflow step.
 * @param updates - List of work item updates
 *
 * @returns a map of workflow step to a list of work item updates on that workflow step.
 */
function groupByWorkflowStepIndex(
  updates: WorkItemUpdateQueueItem[]): Record<number, WorkItemUpdateQueueItem[]> {

  return updates.reduce((result, currentUpdate) => {
    const { workflowStepIndex } = currentUpdate.update;

    // Initialize an array for the step if it doesn't exist
    if (!result[workflowStepIndex]) {
      result[workflowStepIndex] = [];
    }

    result[workflowStepIndex].push(currentUpdate);

    return result;
  }, {} as Record<number, WorkItemUpdateQueueItem[]>);
}

/**
 * Updates the batch of work items.
 * It is assumed that all the work items belong to the same job.
 * It processes the work item updates in groups by the workflow step.
 * @param jobID - ID of the job that the work item updates belong to
 * @param updates - List of work item updates
 * @param logger - Logger to use
 */
async function handleBatchWorkItemUpdatesWithJobId(
  jobID: string,
  updates: WorkItemUpdateQueueItem[],
  logger: Logger): Promise<void> {
  const startTime = new Date().getTime();
  logger.debug(`Processing ${updates.length} work item updates for job ${jobID}`);
  // group updates by workflow step index to make sure at least one completion check is performed for each step
  const groups = groupByWorkflowStepIndex(updates);
  for (const workflowStepIndex of Object.keys(groups)) {
    const nextWorkflowStep = await (await logAsyncExecutionTime(
      getWorkflowStepByJobIdStepIndex,
      'HWIUWJI.getWorkflowStepByJobIdStepIndex',
      logger))(db, jobID, parseInt(workflowStepIndex) + 1);

    const preprocessedWorkItems: WorkItemUpdateQueueItem[] = await Promise.all(
      groups[workflowStepIndex].map(async (item: WorkItemUpdateQueueItem) => {
        const { update, operation } = item;
        const result = await preprocessWorkItem(update, operation, logger, nextWorkflowStep);
        item.preprocessResult = result;
        return item;
      }));
    await processWorkItems(jobID, parseInt(workflowStepIndex), preprocessedWorkItems, logger);
  }
  const durationMs = new Date().getTime() - startTime;
  logger.debug('timing.HWIUWJI.batch.end', { durationMs });
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
      if (!jobID) {
        logger.error(`Received a message to process a work item that could not be found in the jobs table ${workItemID}.`, item);
      } else {
        logger.debug(`Processing work item update for job ${jobID}`);
        const accValue = await acc;
        if (accValue[jobID]) {
          accValue[jobID].push(item);
        } else {
          accValue[jobID] = [item];
        }
        return accValue;
      }
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
  const queue = qf.getQueueForType(queueType);
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
      await exports.handleBatchWorkItemUpdates(updates, defaultLogger);
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
