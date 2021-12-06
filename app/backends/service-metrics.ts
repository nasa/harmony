import { Response, Request, NextFunction } from 'express';
import log from '../util/log';
import { workItemCountByServiceIDAndStatus, WorkItemStatus } from '../models/work-item';
import db from '../util/db';
import { RequestValidationError } from '../util/errors';

/**
 * Express.js handler that returns the number of work items in the 'READY' state for the given serviceID
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getReadyWorkItemCountForServiceID(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {

  const logger = log.child({
    component: 'service/metrics',
    application: 'backend',
  });

  const serviceID = req.query.serviceID as string;
  logger.info(`Get work item count for service ${serviceID} in READY state`);

  // Return 400 if serviceID not provided in query
  if (!serviceID) {
    const err_message = 'required parameter "serviceID" was not provided';
    next(new RequestValidationError(err_message));
    return;
  }

  try {
    let workItemCount;
    await db.transaction(async (tx) => {
      workItemCount = await workItemCountByServiceIDAndStatus(tx, serviceID, [WorkItemStatus.READY]);
    });
    if (!workItemCount) workItemCount = 0;
    const response = {
      availableWorkItems: workItemCount,
    };
    res.json(response);
  } catch (e) {
    next(e);
  }
}