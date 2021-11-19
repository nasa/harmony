import { Response, NextFunction } from 'express';
import WorkItem, { workItemCountByServiceIDAndStatus, WorkItemStatus } from '../models/work-item';
import { RequestValidationError, NotFoundError } from '../util/errors';
import { getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import { ArgoServiceParams } from '../models/services/argo-service';
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
  const serviceID = req.query.serviceID as string;
  req.context.logger.info(`Get job status for job ${serviceID} in READY state`);
  if (!serviceID) res.status(400).send("required parameter \"serviceID\" was not provided");
  const serviceNameList = await Promise.all((getServiceConfigs() as ServiceConfig<ArgoServiceParams>[])
    .filter((s) => s.type.name === 'argo')
    .map((service) => service.type.params.image));
  if (serviceNameList.indexOf(serviceID) === -1) res.status(404).send(`service [${serviceID}] does not exist`);
  try {
    // validateJobId(jobID);
    let workItemCount;
    await db.transaction(async (tx) => {
      (workItemCount = await workItemCountByServiceIDAndStatus(tx, serviceID, [WorkItemStatus.READY]));
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