import * as k8s from '@kubernetes/client-node';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import logger from '../../../../app/util/log';
import { getQueueUrlForService, getQueueForUrl } from '../../../../app/util/queue/queue-factory';
import { getWorkFromDatabase } from '../../../../app/backends/workflow-orchestration/work-item-polling';
import { getPodsCountForService } from '../util/k8s';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

/**
 * Get services from the environment. This is a function so that it's behavior can be changed
 * for testing by changing the environment.
 * @returns An array of service IDs
 */
function getServices(): string[] {
  return Object.keys(env.serviceQueueUrls);
}

/**
 * Update the service queues by reading work items from the database and sending them to the
 * appropriate service queue.
 */
export async function updateServiceQueues(): Promise<void> {
  logger.debug('Updating service queues');
  for (const serviceID of getServices()) {
    try {
      logger.info(`Checking service ${serviceID}`);
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
      logger.debug(`Attempting to retrieve ${batchSize} work items for queue ${queueUrl}`);

      // TODO - do this as a batch instead of one at a time - HARMONY-1417
      let queuedCount = 0;
      for (let i = 0; i < batchSize; i++) {
        const workItem = await getWorkFromDatabase(serviceID, logger);
        if (workItem) {
          const json = JSON.stringify(workItem);
          logger.info(`Sending work item ${workItem.workItem.id} to queue ${queueUrl}`);
          // must include groupId for FIFO queues, but we don't care about it so just use 'w'
          await queue.sendMessage(json, 'w');
          queuedCount++;
        } else {
          break;
        }
      }
      if (queuedCount > 0) {
        logger.info(`Sent ${queuedCount} work items to queue ${queueUrl}`);
      }
    } catch (e) {
      logger.error(e);
      continue;
    }
  }
}

export default class Scheduler implements Worker {
  async start(repeat = true): Promise<void> {
    logger.debug('Starting scheduler');
    while (repeat) {
      try {
        await updateServiceQueues();
      } catch (e) {
        logger.error(e);
      }
    }
  }
}