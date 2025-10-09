import _ from 'lodash';
import { LRUCache } from 'lru-cache';
import { Logger } from 'winston';

import * as k8s from '@kubernetes/client-node';

import { QUERY_CMR_SERVICE_REGEX } from '../../../harmony/app/backends/workflow-orchestration/util';
import {
  getWorkItemsFromDatabase,
} from '../../../harmony/app/backends/workflow-orchestration/work-item-polling';
import logger from '../../../harmony/app/util/log';
import { logAsyncExecutionTime } from '../../../harmony/app/util/log-execution';
import { Queue, ReceivedMessage, WorkItemQueueType } from '../../../harmony/app/util/queue/queue';
import {
  getQueueForType, getQueueForUrl, getQueueUrlForService, getWorkSchedulerQueue,
} from '../../../harmony/app/util/queue/queue-factory';
import sleep from '../../../harmony/app/util/sleep';
import { Worker } from '../../../harmony/app/workers/worker';
import env from '../util/env';
import { getPodsCountForPodName, getPodsCountForService } from '../util/k8s';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const SCHEDULER_POD_NAME = 'harmony-work-scheduler';

/**
 * Calls the k8s API to get a count of the number of pods with the given serviceID
 * @param serviceID - the service id
 * @param _sv - The "stale value" from LRUCache; unused in this implementation
 * @param reqLogger - the logger for the request
 * @returns the pod count
 */
async function servicePodCountFetcher(serviceID: string, _sv, { context: fetchContext }): Promise<number> {
  const timed = await logAsyncExecutionTime(
    getPodsCountForService,
    `PSQ.getPodsCountForService ${serviceID}`,
    fetchContext.logger,
  );
  return timed(serviceID);
}

/**
 * Calls the k8s API to get a count of the number of pods with the given podName
 * @param podName - the pod name
 * @param _sv - The "stale value" from LRUCache; unused in this implementation
 * @param reqLogger - the logger for the request
 * @returns the pod count
 */
async function schedulerPodCountFetcher(podName: string, _sv, { context: fetchContext }): Promise<number> {
  const timed = await logAsyncExecutionTime(
    getPodsCountForPodName,
    `PSQ.getSchedulerPodsCount ${podName}`,
    fetchContext.logger,
  );
  return timed(podName);
}

const servicePodCountCache = new LRUCache<string, number>({
  ttl: env.podCountCacheTtl,
  max: 1000,
  fetchMethod: servicePodCountFetcher,
});

const schedulerPodCountCache = new LRUCache<string, number>({
  ttl: env.podCountCacheTtl,
  max: 1000,
  fetchMethod: schedulerPodCountFetcher,
});

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
 * @param numMessagesReceived - the number of messages the work scheduler received for this service
 * @returns the number of work items to request to queue
 */
export function calculateNumItemsToQueue(
  servicePodCount: number, schedulerPodCount: number, queuedCount: number, scaleFactor: number,
  numMessagesReceived: number,
): number {
  // If there are hardly any messages on the queue we want to try to figure out if there are
  // many pods asking for work meaning we've starved the queue. If there are then we want to queue
  // a large number of messages.
  if (queuedCount <= 0.1 * servicePodCount) {
    const fullQueueCount = servicePodCount - queuedCount;

    // Queue enough work to match the number of messages received without queueing more than the
    // number of available service pods. Always return at least 1 item to be queued.
    return Math.max(1, Math.min(fullQueueCount, numMessagesReceived));
  }

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

type QueueItem = {
  body: string;        // serviceID
  receipt: string;     // SQS receiptHandle
};

/**
 * Read the scheduler queue and process any items in it
 *
 * @param reqLogger - a logger instance
 * @param schedulerDisabledDelay - number of ms to sleep when the scheduler is disabled because
 * there are too many items on the work item update queue. Override to a small value in tests.
 * @returns A promise that resolves when the scheduler queue is empty
 * @throws An error if there is no queue URL for a service ID
 * @throws An error if there is no queue for a queue URL
 **/
export async function processSchedulerQueue(
  reqLogger: Logger, schedulerDisabledDelay = 3000,
): Promise<void> {
  reqLogger.debug('Processing scheduler queue');
  const startTime = new Date().getTime();
  let durationMs;
  const schedulerQueue = getWorkSchedulerQueue();
  const queueItems = await (await logAsyncExecutionTime(
    drainQueue,
    'PSQ.drainQueue',
    reqLogger))(schedulerQueue, reqLogger);

  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);

  if (env.maxWorkItemsOnUpdateQueue !== -1) {
    const smallUpdateQueue = getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE);
    const updateQueueCount = await smallUpdateQueue.getApproximateNumberOfMessages();
    if (updateQueueCount > env.maxWorkItemsOnUpdateQueue) {
      logger.warn(`Work item update queue is too large with ${updateQueueCount} items, will not schedule more work`);
      await sleep(schedulerDisabledDelay);
      return;
    }
  }

  const groupedByServiceID: Record<string, QueueItem[]> = _.groupBy(queueItems, item => item.body);

  for (const [serviceID, items] of Object.entries(groupedByServiceID)) {
    const numMessagesReceived = items.length;
    reqLogger.info(`Processing ${numMessagesReceived} queued messages for service ${serviceID}`);
    reqLogger.info(`Processing scheduler queue item for service ${serviceID}`);
    const queueUrl = getQueueUrlForService(serviceID);
    const queue = getQueueForUrl(queueUrl);
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
    const messageCountTime = messageCountEnd.getTime() - messageCountStart.getTime();
    reqLogger.debug(`Message count took ${messageCountTime}ms`, { durationMs: messageCountTime });

    const servicePodCount = await servicePodCountCache.fetch(serviceID, { context: { logger: reqLogger } });
    const schedulerPodCount = await schedulerPodCountCache.fetch(SCHEDULER_POD_NAME, { context: { logger: reqLogger } });

    let scaleFactor = env.serviceQueueBatchSizeCoefficient;
    // Use a different scale factor for fast services (now only query-cmr)
    if (QUERY_CMR_SERVICE_REGEX.test(serviceID)) {
      scaleFactor = env.fastServiceQueueBatchSizeCoefficient;
    }

    const workSize = calculateNumItemsToQueue(servicePodCount, schedulerPodCount, messageCount, scaleFactor, numMessagesReceived);
    reqLogger.debug(`Work size count is ${workSize} based on service pod count of ${servicePodCount}, message count ${messageCount}, scheduler pod count ${schedulerPodCount}, numMessagesReceived ${numMessagesReceived}, and scaleFactor ${scaleFactor} for queue ${queueUrl}`);
    reqLogger.debug(`Attempting to retrieve ${workSize} work items for queue ${queueUrl}`);

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

    reqLogger.info('Sending delete message to scheduler queue');

    const dmStartTime = new Date().getTime();
    await schedulerQueue.deleteMessages(items.map((item => item.receipt)));
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