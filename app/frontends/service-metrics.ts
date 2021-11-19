import { Response, NextFunction } from 'express';
import WorkItem, { workItemCountByServiceIDAndStatus, WorkItemStatus } from '../models/work-item';
import { keysToLowerCase } from '../util/object';
import { RequestValidationError, NotFoundError } from '../util/errors';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import env = require('../util/env');

/**
 * Express.js handler that returns the number of work items in the 'READY' state for the given serviceID
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getReadyWorkItemCountForServiceID(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const serviceID = req.query.serviceID;
  req.context.logger.info(`Get job status for job ${serviceID} in READY state`);
  if (!serviceID) res.status(400).send("required parameter \"serviceID\" was not provided");
  try {
    // validateJobId(jobID);
    let workItemCount;
    await db.transaction(async (tx) => {
      (workItemCount = await workItemCountByServiceIDAndStatus(tx, serviceID as string, [WorkItemStatus.READY]));
    });
    if (!workItemCount) workItemCount = 0;
    const response = {
      availableWorkItems: workItemCount,
    };
    res.json(response);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}