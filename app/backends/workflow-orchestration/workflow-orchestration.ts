import db from '../../util/db';
import _ from 'lodash';
import { NextFunction, Response } from 'express';
import { Logger } from 'winston';
import env from '../../util/env';
import HarmonyRequest from '../../models/harmony-request';
import WorkItem, { getNextWorkItem } from '../../models/work-item';
import { WorkItemMeta, WorkItemStatus } from '../../models/work-item-interface';
import { getNextJobIdForUsernameAndService, getNextUsernameForWork, incrementRunningAndDecrementReadyCounts } from '../../models/user-work';
import { sanitizeImage } from '../../util/string';
import { WorkItemUpdateQueueType } from '../../util/queue/queue';
import { getQueueForType, getQueueForUrl, getWorkSchedulerQueue  } from '../../util/queue/queue-factory';
import { calculateQueryCmrLimit } from './work-item-updates';

const MAX_TRY_COUNT = 1;
const RETRY_DELAY = 1000 * 120;
const QUERY_CMR_SERVICE_REGEX = /harmonyservices\/query-cmr:.*/;

type WorkItemData = {
  workItem: WorkItem,
  maxCmrGranules: number
};

/**
 * Get the next work item for the given service from the queue
 * @param serviceID - The service ID for which to get work
 */
async function getWorkFromQueue(serviceID: string): Promise<WorkItemData> {
  const queueUrl = env.serviceQueueUrls[serviceID];
  if (!queueUrl) {
    throw new Error(`No queue URL found for service ${serviceID}`);
  }

  const queue = getQueueForUrl(queueUrl);
  if (!queue) {
    throw new Error(`No queue found for URL ${queueUrl}`);
  }

  // get a message from the service queue without using long-polling
  let queueItem = await queue.getMessage(0);
  if (!queueItem) {
    // put a message on the scheduler queue asking it to schedule some WorkItems for this service
    const schedulerQueue = getWorkSchedulerQueue();
    await schedulerQueue.sendMessage(serviceID);

    // long poll for work multiple times before giving up
    let count = 0;
    while (true) {
      queueItem = await queue.getMessage();
      count++;
      if (count === 3) {
        break;
      }
    }
  }

  if (queueItem){
    const item = JSON.parse(queueItem.body) as WorkItemData;
    return item;
  }

  return null;
}

/**
 *
 * @param serviceID - TODO
 * @param reqLogger - TODO
 * @param podName - TODO
 * @param res - TODO
 * @param responded - TODO
 * @returns
 */
async function getWorkFromDatabase(serviceID: string, reqLogger: Logger, podName: string, res: Response): Promise<boolean> {
  let responded = false;
  await db.transaction(async (tx) => {
    const username = await getNextUsernameForWork(tx, serviceID as string);
    if (username) {
      const jobID = await getNextJobIdForUsernameAndService(tx, serviceID as string, username);
      if (jobID) {
        const workItem = await getNextWorkItem(tx, serviceID as string, jobID);
        if (workItem) {
          await incrementRunningAndDecrementReadyCounts(tx, jobID, serviceID as string);
          const logger = reqLogger.child({ workItemId: workItem.id });
          const waitSeconds = (Date.now() - workItem.createdAt.valueOf()) / 1000;
          const itemMeta: WorkItemMeta = {
            workItemEvent: 'statusUpdate', workItemDuration: waitSeconds,
            workItemService: sanitizeImage(workItem.serviceID), workItemAmount: 1, workItemStatus: WorkItemStatus.RUNNING,
          };
          logger.info(`Sending work item ${workItem.id} to pod ${podName}`, itemMeta);
          if (workItem && QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
            const maxCmrGranules = await calculateQueryCmrLimit(tx, workItem, logger);
            res.send({ workItem, maxCmrGranules });
            responded = true;
          } else {
            res.send({ workItem });
            responded = true;
          }
        } else {
          reqLogger.warn(`user_work is out of sync for user ${username} and job ${jobID}, could not find ready work item`);
        }
      }
    }
  });
  return responded;
}

/**
 * Return a work item for the given service
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getWork(
  req: HarmonyRequest, res: Response, next: NextFunction, tryCount = 1,
): Promise<void> {
  const reqLogger = req.context.logger;
  const { serviceID, podName } = req.query;
  reqLogger.info(`Getting work for service ${serviceID} and pod ${podName}`);

  let responded = false;

  if (env.useServiceQueues) {
    const workItemData = await getWorkFromQueue(serviceID as string);
    if (workItemData){
      const { workItem, maxCmrGranules } = workItemData;
      if (QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
        res.send({ workItem, maxCmrGranules });
      } else {
        res.send({ workItem });
      }

      responded = true;
    }
  } else {
    responded = await getWorkFromDatabase(serviceID as string, reqLogger, podName as string, res);
  }

  if (!responded) {
    if (tryCount < MAX_TRY_COUNT) {
      setTimeout(async () => {
        await getWork(req, res, next, tryCount + 1);
      }, RETRY_DELAY);
    } else {
      res.status(404).send();
    }
  }
}

/**
 * Update a work item from a service response. This function stores the update in a queue
 * without further processing and then responds quickly. Processing the update is handled
 * asynchronously (see `batchProcessQueue`)
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function updateWorkItem(req: HarmonyRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, hits, results, scrollID, errorMessage, duration, operation, outputItemSizes } = req.body;
  const totalItemsSize = req.body.totalItemsSize ? parseFloat(req.body.totalItemsSize) : 0;

  const update = {
    workItemID: parseInt(id),
    status,
    hits,
    results,
    scrollID,
    errorMessage,
    totalItemsSize,
    outputItemSizes,
    duration,
  };
  const workItemLogger = req.context.logger.child({ workItemId: update.workItemID });

  // we use separate queues for small and large work item updates
  let queueType = WorkItemUpdateQueueType.SMALL_ITEM_UPDATE;
  if (results?.length > 1) {
    workItemLogger.debug('Sending work item update to large item queue');
    queueType = WorkItemUpdateQueueType.LARGE_ITEM_UPDATE;
  } else {
    workItemLogger.debug('Sending work item update to regular queue');
  }
  const queue = getQueueForType(queueType);
  await queue.sendMessage(JSON.stringify({ update, operation })).catch((e) => {
    workItemLogger.error(e);
  });

  // Return a success status with no body
  res.status(204).send();
}
