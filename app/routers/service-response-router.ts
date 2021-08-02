import { Request, Response, Router, json, NextFunction } from 'express';
import HarmonyRequest from 'models/harmony-request';
import WorkItem, { getNextWorkItem, getWorkItemById, updateWorkItemStatus, WorkItemStatus } from 'models/work-item';
import db from 'util/db';
import { responseHandler } from '../backends/service-response';
import argoResponsehandler from '../backends/argo-response';
import log from '../util/log';

/**
 * Return a work item for the given service
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
async function getWork(req: HarmonyRequest, res: Response, _next: NextFunction): Promise<void> {
  const { serviceID } = req.query;
  const { logger } = req.context;
  logger.info(`Getting work for service [${serviceID}]`);
  let workItem;
  await db.transaction(async (tx) => {
    workItem = await getNextWorkItem(tx, serviceID as string);
  });
  if (workItem) {
    res.send(workItem);
  } else {
    res.status(404).send();
  }
}

/**
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
async function createWorkItem(req: Request, res: Response): Promise<void> {
  const { serviceID, stacItemLocation, jobID, scrollID } = req.body;
  log.info(`Creating work item for jobID ${jobID}, service ${serviceID}, ${stacItemLocation}`);
  let workItem;
  await db.transaction(async (tx) => {
    workItem = new WorkItem({
      jobID,
      scrollID,
      serviceID,
      stacItemLocation,
      status: WorkItemStatus.READY,
    });
    await workItem.save(tx);
  });
  res.send(workItem);
}

/**
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
async function updateWorkItem(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status } = req.body;
  log.info(`Updating work item for ${id} to ${status}`);
  let workItem;
  await db.transaction(async (tx) => {
    await updateWorkItemStatus(tx, id, status as WorkItemStatus);
    workItem = getWorkItemById(tx, parseInt(id, 10));
    // update the job status
  });
  res.send(workItem);
}

/**
 * Creates and returns an Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns A router which can respond to backend services
 */
export default function router(): Router {
  const result = Router();
  result.use(json({
    type: 'application/json',
  }));
  result.post('/:requestId/response', responseHandler);
  result.post('/:requestId/argo-response', argoResponsehandler);
  result.post('/work', createWorkItem);
  result.get('/work', getWork);
  result.put('/work/:id', updateWorkItem);

  result.use((err, _req, _res, _next) => {
    if (err) {
      log.error(err);
    } else {
      log.error('404');
    }
  });
  return result;
}
