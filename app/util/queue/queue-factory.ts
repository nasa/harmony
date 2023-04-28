import env from '../env';
import { WorkItemUpdateQueueType, Queue } from './queue';
import { SqsQueue } from './sqs-queue';

const queues = {};

/**
 * This function returns a queue object based on the type of work item update queue requested.
 * The queue objects are created using the SqsQueue class and the URLs for the queues are
 * obtained from the environment variables. If the queue object has already been created, it is
 * returned from the `queues` object.
 * @param type - determines which queue object to return
 * @returns a queue object based on the type of work item update queue specified as the input
 * parameter.
 */
export function getQueue(type: WorkItemUpdateQueueType): Queue {
  if (Object.keys(queues).length === 0) {
    queues[WorkItemUpdateQueueType.SMALL_ITEM_UPDATE] = new SqsQueue(env.workItemUpdateQueueUrl);
    queues[WorkItemUpdateQueueType.LARGE_ITEM_UPDATE] = new SqsQueue(env.largeWorkItemUpdateQueueUrl);
    queues[WorkItemUpdateQueueType.SYNCHRONOUS_ITEM_UPDATE] = new SqsQueue(env.synchronousWorkItemUpdateQueueUrl);
  }
  return queues[type];
}