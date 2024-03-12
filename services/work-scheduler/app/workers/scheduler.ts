import * as k8s from '@kubernetes/client-node';
import { Worker } from '@harmony/harmony/app/workers/worker';
import env from '../util/env';
import logger from '@harmony/harmony/app/util/log';
import { logAsyncExecutionTime } from '@harmony/harmony/app/util/log-execution';
import { Logger } from 'winston';
import { queuefactory as qf } from '@harmony/util';
import { getWorkItemsFromDatabase } from '@harmony/harmony/app/backends/workflow-orchestration/work-item-polling';
import { getPodsCountForPodName, getPodsCountForService } from '../util/k8s';
import { Queue, ReceivedMessage } from '@harmony/util/queue';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const SCHEDULER_POD_NAME = 'harmony-work-scheduler';

/**
 * Read all the messages from a queue (up to the default timeout period) and return them.
 * @param queue - the queue to drain
 */
async function drainQueue(queue: Queue, reqLogger: Logger): Promise<ReceivedMessage[]> {
  const allMessages: ReceivedMessage[] = [];
  // long poll for messages the first time through
  let startTime = new Date().getTime();
  let durationMs;
  let messages = await queue.getMessages(env.workItemSchedulerQueueMaxBatchSize);
  if (messages.length > 0) {
    allMessages.push(...messages);
  }
  durationMs = new Date().getTime() - startTime;
  reqLogger.debug('timing.PSQ.queue.getFirstMessages.end', { durationMs });
  let receiveCount = 1;
  while (messages.length > 0 && receiveCount < env.workItemSchedulerQueueMaxGetMessageRequests) {
    // get the next batch of messages with a short poll
    startTime = new Date().getTime();
    messages = await queue.getMessages(env.workItemSchedulerQueueMaxBatchSize, 0);
    if (messages.length > 0) {
      allMessages.push(...messages);
    }
    durationMs = new Date().getTime() - startTime;
    reqLogger.debug('timing.PSQ.queue.getMessages.end', { durationMs });
    receiveCount++;
  }

  return allMessages;
}

/**
 * Returns the list of batch sizes for a given size
 * @param workSize - the size to break into batches
 * @param batchSize - - the batch size
 *
 * @returns A list of batch sizes for the given size
 */
function sizeToBatches(
  workSize: number,
  batchSize: number,
): number[] {
  const batches: number[] = [];

  while (workSize > 0) {
    if (workSize >= batchSize) {
      batches.push(batchSize);
      workSize -= batchSize;
    } else {
      batches.push(workSize);
      workSize = 0;
    }
  }

  return batches;
}

/**
 * Calculates the number of work items to request to queue
 *
 * @param servicePodCount - number of service pods running
 * @param schedulerPodCount - number of work scheduler pods running
 * @param queuedCount - current number of messages on the service queue
 * @param scaleFactor - percent of the number of messages we want
 * @returns the number of work items to request to queue
 */
export function calculateNumItemsToQueue(
  servicePodCount: number, schedulerPodCount: number, queuedCount: number, scaleFactor: number,
): number {
  const minOneSchedulerPodCount = Math.max(1, schedulerPodCount);
  const numItemsToQueue = scaleFactor * (servicePodCount / minOneSchedulerPodCount) - queuedCount;
  let numItemsToQueueInt = Math.max(0, Math.floor(numItemsToQueue));

  // With some configurations it's possible to request zero items in all cases. Make sure we avoid
  // the situation where we never queue anything
  if (numItemsToQueueInt <= 0 && queuedCount <= 0) {
    numItemsToQueueInt = 1;
  }
  return numItemsToQueueInt;
}

/**
 * Read the scheduler queue and process any items in it
 *
 * @param reqLogger - a logger instance
 * @returns A promise that resolves when the scheduler queue is empty
 * @throws An error if there is no queue URL for a service ID
 * @throws An error if there is no queue for a queue URL
 **/
export async function processSchedulerQueue(reqLogger: Logger): Promise<void> {
  reqLogger.debug('Processing scheduler queue');
  const startTime = new Date().getTime();
  let durationMs;
  const schedulerQueue = qf.getWorkSchedulerQueue();
  const queueItems = await (await logAsyncExecutionTime(
    drainQueue,
    'PSQ.drainQueue',
    reqLogger))(schedulerQueue, reqLogger);

  const processedServiceIDs: string[] = [];

  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);
  for (const queueItem of queueItems) {
    const serviceID = queueItem.body;
    if (!processedServiceIDs.includes(serviceID)) {
      processedServiceIDs.push(serviceID);
      reqLogger.info(`Processing scheduler queue item for service ${serviceID}`);
      const queueUrl = qf.getQueueUrlForService(serviceID);
      const queue = qf.getQueueForUrl(queueUrl);
      if (!queue) {
        throw new Error(`No queue found for URL ${queueUrl}`);
      }

      // Get the number of messages in the queue and the number of pods for the service
      // so we can determine how many work items to send
      const messageCountStart = new Date();
      const mcStartTime = new Date().getTime();
      const messageCount = await queue.getApproximateNumberOfMessages();
      durationMs = new Date().getTime() - mcStartTime;
      logger.debug('timing.PSQ.queue.getApproximateNumberOfMessages.end', { durationMs });
      const messageCountEnd = new Date();
      const servicePodCount = await (await logAsyncExecutionTime(
        getPodsCountForService,
        'PSQ.getPodsCountForService',
        reqLogger))(serviceID);

      const schedulerPodCount = await (await logAsyncExecutionTime(
        getPodsCountForPodName,
        'PSQ.getSchedulerPodsCount',
        reqLogger))(SCHEDULER_POD_NAME);

      const podCountEnd = new Date();
      const messageCountTime = messageCountEnd.getTime() - messageCountStart.getTime();
      const podCountTime = podCountEnd.getTime() - messageCountEnd.getTime();
      reqLogger.debug(`Message count took ${messageCountTime}ms`, { durationMs: messageCountTime });
      reqLogger.debug(`Pod count took ${podCountTime}ms`, { durationMs: podCountTime });

      const workSize = calculateNumItemsToQueue(servicePodCount, schedulerPodCount, messageCount, env.serviceQueueBatchSizeCoefficient);
      reqLogger.debug(`Attempting to retrieve ${workSize} work items for queue ${queueUrl}`);
      reqLogger.debug(`Work size count is ${workSize} based on service pod count of ${servicePodCount}, message count ${messageCount}, and scheduler pod count ${schedulerPodCount} for queue ${queueUrl}`);

      let queuedCount = 0;
      const batchStartTime = new Date().getTime();
      for (const chunk of sizeToBatches(workSize, env.workItemSchedulerBatchSize)) {
        const workItems = await (await logAsyncExecutionTime(
          getWorkItemsFromDatabase,
          'PSQ.getWorkItemsFromDatabase',
          reqLogger))(serviceID, reqLogger, chunk);

        for (const workItem of workItems) {
          const json = JSON.stringify(workItem);
          reqLogger.info(`Sending work item ${workItem.workItem.id} to queue ${queueUrl}`);
          const smStartTime = new Date().getTime();
          await queue.sendMessage(json, `${workItem.workItem.id}`);
          durationMs = new Date().getTime() - smStartTime;
          logger.debug('timing.PSQ.queue.sendMessage.end', { durationMs });
          queuedCount++;
        }
      }

      durationMs = new Date().getTime() - batchStartTime;
      logger.debug('timing.PSQ.batchProcessing.end', { durationMs });

      reqLogger.info(`Sent ${queuedCount} work items to queue ${queueUrl}`);
    }

    reqLogger.info('Sending delete message to scheduler queue');

    const dmStartTime = new Date().getTime();
    await schedulerQueue.deleteMessage(queueItem.receipt);
    durationMs = new Date().getTime() - dmStartTime;
    logger.debug('timing.PSQ.queue.deleteMessage.end', { durationMs });
  }

  durationMs = new Date().getTime() - startTime;
  logger.debug('timing.PSQ.processSchedulerQueue.end', { durationMs });
}

export default class Scheduler implements Worker {
  async start(repeat = true): Promise<void> {
    logger.debug('Starting scheduler');
    while (repeat) {
      try {
        await processSchedulerQueue(logger);
      } catch (e) {
        logger.error(e);
      }
    }
  }
}
