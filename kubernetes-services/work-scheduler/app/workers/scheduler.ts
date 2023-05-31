import * as k8s from '@kubernetes/client-node';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import logger from '../../../../app/util/log';
import { Logger } from 'winston';
import { getQueueUrlForService, getQueueForUrl, getWorkSchedulerQueue } from '../../../../app/util/queue/queue-factory';
import { getWorkFromDatabase } from '../../../../app/backends/workflow-orchestration/work-item-polling';
import { getPodsCountForService } from '../util/k8s';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

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
  const queueItems = await schedulerQueue.getMessages(env.schedulerQueueBatchSize);

  reqLogger.debug(`Found ${queueItems.length} items in the scheduler queue`);
  for (const queueItem of queueItems) {
    const serviceID = queueItem.body;
    reqLogger.info(`Processing scheduler queue item for service ${serviceID}`);
    const queueUrl = getQueueUrlForService(serviceID);
    const queue = getQueueForUrl(queueUrl);
    if (!queue) {
      throw new Error(`No queue found for URL ${queueUrl}`);
    }

    // Get the number of messages in the queue and the number of pods for the service
    // so we can determine how many work items to send
    const messageCount = await queue.getApproximateNumberOfMessages();
    const podCount = await getPodsCountForService(serviceID);

    // If there are more pods than messages, we need to send more work. Allow more work
    // than pods to avoid queue starvation (env.serviceQueueBatchSizeCoefficient)
    const batchSize = Math.floor(env.serviceQueueBatchSizeCoefficient * podCount - messageCount);
    reqLogger.debug(`Attempting to retrieve ${batchSize} work items for queue ${queueUrl}`);

    // TODO - do this as a batch instead of one at a time - HARMONY-1417
    for (let i = 0; i < batchSize; i++) {
      const workItem = await getWorkFromDatabase(serviceID, reqLogger);
      if (workItem) {
        const json = JSON.stringify(workItem);
        reqLogger.info(`Sending work item ${workItem.workItem.id} to queue ${queueUrl}`);
        // must include groupId for FIFO queues, but we don't care about it so just use 'w'
        await queue.sendMessage(json, 'w');
      } else {
        break;
      }
    }
    reqLogger.info('Sending delete message to scheduler queue');
    await schedulerQueue.deleteMessage(queueItem.receipt);
  }

}

export default class Scheduler implements Worker {
  async start(repeat = true): Promise<void> {
    logger.debug('Starting scheduler');
    while (repeat) {
      await processSchedulerQueue(logger);
    }
  }
}