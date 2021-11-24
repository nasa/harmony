import { Response, Request, NextFunction } from 'express';
import log from '../util/log';
import { workItemCountByServiceIDAndStatus, WorkItemStatus } from '../models/work-item';
import { getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import { ArgoServiceParams } from '../models/services/argo-service';
import db from '../util/db';
import { NotFoundError, RequestValidationError } from '../util/errors';

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
    logger.error(err_message);
    next(new RequestValidationError(err_message));
    return;
  }

  // Return 404 if requested serviceID is not valid
  const serviceNameList = await Promise.all((getServiceConfigs() as ServiceConfig<ArgoServiceParams>[])
    .filter((s) => s.type.name === 'argo')
    .map((service) => service.type.params.image));
  if (serviceNameList.indexOf(serviceID) === -1) {
    const err_message = `service [${serviceID}] does not exist`; 
    logger.error(err_message);
    next(new NotFoundError(err_message));
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
    logger.error(e);
    next(e);
  }
}