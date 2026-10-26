import { Logger } from 'winston';

import {
  handleBatchWorkItemUpdatesWithJobId, WorkItemUpdateQueueItem,
} from '../../../harmony/app/backends/workflow-orchestration/work-item-updates';
import { getJobStatusForJobID, terminalStates } from '../../../harmony/app/models/job';
import { getJobIdForWorkItem } from '../../../harmony/app/models/work-item';
import { default as defaultLogger } from '../../../harmony/app/util/log';
import { Queue, WorkItemQueueType } from '../../../harmony/app/util/queue/queue';
import { getQueueForType } from '../../../harmony/app/util/queue/queue-factory';
import sleep from '../../../harmony/app/util/sleep';
import { Worker } from '../../../harmony/app/workers/worker';
import env from '../util/env';

/**
 * This function processes a batch of work item updates.
 * It first creates a map of jobIDs to updates, then it processes each job's updates.
 * It calls the function handleBatchWorkItemUpdatesWithJobId to handle the updates.
 * @param updates - List of work item updates read from the queue
 * @param logger - Logger to use
 */
export async function handleBatchWorkItemUpdates(
  updates: WorkItemUpdateQueueItem[],
  logger: Logger,
): Promise<void> {
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
  // process each job's updates - different jobs never share a row lock (each job's transaction
  // locks only its own jobID), so it's safe to process them concurrently rather than blocking
  // every other job in the batch behind one slow job (e.g. a slow S3 catalog read).
  await Promise.allSettled(Object.keys(jobUpdates).map(async (jobID): Promise<void> => {
    try {
      const jobStatus = await getJobStatusForJobID(jobID);
      if (terminalStates.includes(jobStatus)) {
        logger.warn(`Ignoring work item updates for job ${jobID} in terminal state ${jobStatus}.`);
        return;
      }
      const startTime = Date.now();
      const jobBatchSize = jobUpdates[jobID].length;
      await handleBatchWorkItemUpdatesWithJobId(jobID, jobUpdates[jobID], logger);
      const durationMs = Date.now() - startTime;
      // jobBatchSize is how many of the messages drained in this poll cycle were for this one
      // job - the key number for spotting a hot job: if it stays at 1 even when the queue is
      // deep, updates for that job are arriving/draining one at a time rather than batching.
      logger.info('timing.updater.handleBatchWorkItemUpdatesWithJobId.end', {
        jobId: jobID,
        jobBatchSize,
        durationMs,
        msPerItem: Math.round(durationMs / jobBatchSize),
      });
    } catch (e) {
      logger.error(`Error processing work item updates for job ${jobID}: ${e}`);
    }
  }));
}

/**
 * Starts periodically extending message visibility.
 *
 * After an initial delay, sets the visibility timeout and continues refreshing
 * it at the specified interval until the returned cleanup function is called.
 *
 * @param queue - Queue being processed
 * @param receipts - Receipt handles to extend
 * @param initialDelaySeconds - Delay before starting visibility extensions
 * @param refreshIntervalSeconds - Interval between visibility extensions
 * @param visibilityTimeoutSeconds - Visibility timeout to set on each extension
 * @returns Cleanup function
 */
export function startVisibilityHeartbeat(
  queue: Queue,
  receipts: string[],
  initialDelaySeconds = 15,
  refreshIntervalSeconds = 30,
  visibilityTimeoutSeconds = 60,
): () => void {
  const extendVisibility = async (): Promise<void> => {
    try {
      defaultLogger.warn(`Extending message visibility by ${visibilityTimeoutSeconds} seconds`);
      await queue.changeMessageVisibilities(
        receipts,
        visibilityTimeoutSeconds,
      );
    } catch (e) {
      defaultLogger.error(`Error extending message visibility timeout: ${e}`);
    }
  };

  let visibilityInterval: NodeJS.Timeout | undefined;

  const visibilityStartTimeout = setTimeout(() => {
    void extendVisibility();

    visibilityInterval = setInterval(() => {
      void extendVisibility();
    }, refreshIntervalSeconds * 1000);
  }, initialDelaySeconds * 1000);

  return (): void => {
    clearTimeout(visibilityStartTimeout);

    if (visibilityInterval) {
      clearInterval(visibilityInterval);
    }
  };
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

  const stopVisibilityHeartbeat = startVisibilityHeartbeat(
    queue,
    messages.map((msg) => msg.receipt),
  );

  try {
    if (queueType === WorkItemQueueType.LARGE_ITEM_UPDATE) {
      // process each message individually
      for (const msg of messages) {
        try {
          const updateItem: WorkItemUpdateQueueItem = JSON.parse(msg.body);
          defaultLogger.debug(`Processing work item update from queue for work item ${updateItem.update.workItemID} and status ${updateItem.update.status}`);
          await exports.handleBatchWorkItemUpdates([updateItem], defaultLogger);
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
      // process all the messages at once
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
  } finally {
    stopVisibilityHeartbeat();
  }

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  // messagesDrained and msPerMessage are the numbers to watch per poll cycle. For the
  // LARGE_ITEM_UPDATE queue, each message is still processed one at a time (see the loop above)
  // regardless of how many were drained together, so msPerMessage there reflects per-message
  // overhead rather than any batching benefit - compare against SMALL_ITEM_UPDATE's
  // msPerMessage, where handleBatchWorkItemUpdates does batch same-job messages together.
  defaultLogger.info('timing.updater.batchProcessQueue.end', {
    queueType,
    messagesDrained: messages.length,
    durationMs,
    msPerMessage: Math.round(durationMs / messages.length),
  });
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
