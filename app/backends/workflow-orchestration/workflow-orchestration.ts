import _ from 'lodash';
import { NextFunction, Response } from 'express';
import env from '../../util/env';
import { Logger } from 'winston';
import HarmonyRequest from '../../models/harmony-request';
import { WorkItemQueueType } from '../../util/queue/queue';
import { getQueueForType  } from '../../util/queue/queue-factory';
import { getWorkFromQueue, getWorkFromDatabase, WorkItemData } from './work-item-polling';
import WorkItemUpdate from '../../models/work-item-update';
import DataOperation from '../../models/data-operation';

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
  let workItemData: WorkItemData | null;

  if (env.useServiceQueues) {
    workItemData = await getWorkFromQueue(serviceID as string, reqLogger);
  } else {
    workItemData = await getWorkFromDatabase(serviceID as string, reqLogger);
  }

  if (workItemData) {
    const { workItem, maxCmrGranules } = workItemData;

    const logger = reqLogger.child({ workItemId: workItem.id });
    logger.info(`Sending work item ${workItem.id} to pod ${podName}`);

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
 * Queue a work item update for the given update and operation
 *
 * @param jobID -
 * @param update -
 * @param operation -
 * @param queueType -
 * @param logger -
 * @returns resolves when message is queued
 */
export async function queueWorkItemUpdate(
  jobID: string, update: WorkItemUpdate, operation: DataOperation, queueType: WorkItemQueueType, logger: Logger,
): Promise<void> {
  // we use separate queues for small and large work item updates
  logger.debug(`Sending work item update to ${queueType} for ${update.workItemID}`);
  const queue = getQueueForType(queueType);
  await queue.sendMessage(JSON.stringify({ update, operation }), jobID).catch((e) => {
    logger.error(e);
  });
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
  const {
    status,
    hits,
    results,
    scrollID,
    workflowStepIndex,
    errorMessage,
    duration,
    operation,
    outputItemSizes } = req.body;
  const totalItemsSize = req.body.totalItemsSize ? parseFloat(req.body.totalItemsSize) : 0;

  const update = {
    workItemID: parseInt(id),
    status,
    hits,
    results,
    scrollID,
    workflowStepIndex,
    errorMessage,
    totalItemsSize,
    outputItemSizes,
    duration,
  };
  const workItemLogger = req.context.logger.child({ workItemId: update.workItemID });
  const queueType = results?.length > 1 ? WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;
  await queueWorkItemUpdate(operation.requestId, update, operation, queueType, workItemLogger);

  // Return a success status with no body
  res.status(204).send();
}
