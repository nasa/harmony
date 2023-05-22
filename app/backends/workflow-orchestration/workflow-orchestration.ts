import _ from 'lodash';
import { NextFunction, Response } from 'express';
import env from '../../util/env';
import HarmonyRequest from '../../models/harmony-request';
import { WorkItemUpdateQueueType } from '../../util/queue/queue';
import { getQueueForType  } from '../../util/queue/queue-factory';
import { getWorkFromQueue, getWorkFromDatabase, WorkItemData } from './work-item-polling';
import { WorkItemMeta, WorkItemStatus } from '../../models/work-item-interface';
import { sanitizeImage } from '../../util/string';


const MAX_TRY_COUNT = 1;
const RETRY_DELAY = 1000 * 120;
const QUERY_CMR_SERVICE_REGEX = /harmonyservices\/query-cmr:.*/;

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
  // reqLogger.info(`Getting work for service ${serviceID} and pod ${podName}`);

  let responded = false;
  let workItemData: WorkItemData;

  if (env.useServiceQueues) {
    workItemData = await getWorkFromQueue(serviceID as string, reqLogger);
  } else {
    workItemData = await getWorkFromDatabase(serviceID as string, reqLogger);
  }

  if (workItemData) {
    const { workItem, maxCmrGranules } = workItemData;

    const logger = reqLogger.child({ workItemId: workItem.id });
    const waitSeconds = (Date.now() - workItem.createdAt.valueOf()) / 1000;
    const itemMeta: WorkItemMeta = {
      workItemEvent: 'statusUpdate', workItemDuration: waitSeconds,
      workItemService: sanitizeImage(workItem.serviceID), workItemAmount: 1, workItemStatus: WorkItemStatus.RUNNING,
    };
    logger.info(`Sending work item ${workItem.id} to pod ${podName}`, itemMeta);

    if (QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
      res.send({ workItem, maxCmrGranules });
    } else {
      res.send({ workItem });
    }

    responded = true;
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
