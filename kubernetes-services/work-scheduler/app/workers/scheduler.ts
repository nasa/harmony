import * as k8s from '@kubernetes/client-node';
import { Worker } from '../../../../app/workers/worker';
import { env } from '@harmony/util';
import logger from '../../../../app/util/log';
import { Logger } from 'winston';
import { getQueueUrlForService, getQueueForUrl, getWorkSchedulerQueue } from '../../../../app/util/queue/queue-factory';
import { getWorkFromDatabase } from '../../../../app/backends/workflow-orchestration/work-item-polling';
import { getPodsCountForService } from '../util/k8s';
import { Queue, ReceivedMessage } from '../../../../app/util/queue/queue';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

/**
 * Read all the messages from a queue (up to the default timeout period) and return them.
 * @param queue - the queue to drain
 */
async function drainQueue(queue: Queue): Promise<ReceivedMessage[]> {
  const allMessages: ReceivedMessage[] = [];
  // long poll for messages the first time through
  let messages = await queue.getMessages(env.workItemSchedulerQueueMaxBatchSize);
  let receiveCount = 1;
  while (messages.length > 0 && receiveCount < env.workItemSchedulerQueueMaxGetMessageRequests) {
    allMessages.push(...messages);
    // get the next batch of messages with a short poll
    messages = await queue.getMessages(env.workItemSchedulerQueueMaxBatchSize, 0);
    receiveCount++;
  }

  return allMessages;
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
  const schedulerQueue = getWorkSchedulerQueue();
  // const queueItems = await schedulerQueue.getMessages(env.workItemSchedulerQueueMaxBatchSize);
  const queueItems = await drainQueue(schedulerQueue);
  const processedServiceIDs: string[] = [];

  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);
  for (const queueItem of queueItems) {
    const serviceID = queueItem.body;
    if (!processedServiceIDs.includes(serviceID)) {
      processedServiceIDs.push(serviceID);
      reqLogger.info(`Processing scheduler queue item for service ${serviceID}`);
      const queueUrl = getQueueUrlForService(serviceID);
      const queue = getQueueForUrl(queueUrl);
      if (!queue) {
        throw new Error(`No queue found for URL ${queueUrl}`);
      }

      // Get the number of messages in the queue and the number of pods for the service
      // so we can determine how many work items to send
      const messageCountStart = new Date();
      const messageCount = await queue.getApproximateNumberOfMessages();
      const messageCountEnd = new Date();
      const podCount = await getPodsCountForService(serviceID);
      const podCountEnd = new Date();
      const messageCountTime = messageCountEnd.getTime() - messageCountStart.getTime();
      const podCountTime = podCountEnd.getTime() - messageCountEnd.getTime();
      reqLogger.debug(`Message count took ${messageCountTime}ms`, { durationMs: messageCountTime });
      reqLogger.debug(`Pod count took ${podCountTime}ms`, { durationMs: podCountTime });

      // If there are more pods than messages, we need to send more work. Allow more work
      // than pods to avoid queue starvation (env.serviceQueueBatchSizeCoefficient)
      const batchSize = Math.floor(env.serviceQueueBatchSizeCoefficient * podCount - messageCount);
      reqLogger.debug(`Attempting to retrieve ${batchSize} work items for queue ${queueUrl}`);

      // TODO - do this as a batch instead of one at a time - HARMONY-1417
      let queuedCount = 0;
      for (let i = 0; i < batchSize; i++) {
        const workItem = await getWorkFromDatabase(serviceID, reqLogger);
        if (workItem) {
          const json = JSON.stringify(workItem);
          reqLogger.info(`Sending work item ${workItem.workItem.id} to queue ${queueUrl}`);
          await queue.sendMessage(json, `${workItem.workItem.id}`);
          queuedCount++;
        } else {
          break;
        }
      }
      reqLogger.info(`Sent ${queuedCount} work items to queue ${queueUrl}`);
    }

    reqLogger.info('Sending delete message to scheduler queue');
    await schedulerQueue.deleteMessage(queueItem.receipt);
  }

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