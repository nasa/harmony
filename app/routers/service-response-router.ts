import { Request, Response, Router, json, NextFunction } from 'express';
import HarmonyRequest from 'models/harmony-request';
import WorkItem, { getNextWorkItem, getWorkItemById, updateWorkItemStatus, WorkItemStatus, workItemCountForStep } from 'models/work-item';
import db, { Transaction } from 'util/db';
import { responseHandler } from '../backends/service-response';
import argoResponsehandler from '../backends/argo-response';
import log from '../util/log';
import { Job, JobStatus } from '../models/job';
import { getWorkflowStepByJobIdStepIndex } from '../models/workflow-steps';

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
  const { serviceID, stacCatalogLocation, jobID, scrollID, workflowStepIndex } = req.body;
  log.info(`Creating work item for jobID ${jobID}, service ${serviceID}, ${stacCatalogLocation}`);
  let workItem;
  await db.transaction(async (tx) => {
    workItem = new WorkItem({
      jobID,
      workflowStepIndex,
      scrollID,
      serviceID,
      stacCatalogLocation,
      status: WorkItemStatus.READY,
    });
    await workItem.save(tx);
  });
  res.send(workItem);
}

/**
 * Add links to the Job for the WorkItem
 *
 * @param workItem - The work item associated with the results
 * @param results  - an array of paths to STAC catalogs
 */
async function _handleWorkItemResults(
  tx: Transaction,
  job: Job,
  results: string[],
): Promise<void> {
  for (const result of results) {
    log.debug(`Adding link for STAC catalog ${result}`);
    // TODO - save the link
  }
}

/**
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
async function updateWorkItem(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, results, errorMessage } = req.body;
  log.info(`Updating work item for ${id} to ${status}`);
  let workItem: WorkItem;
  await db.transaction(async (tx) => {
    await updateWorkItemStatus(tx, id, status as WorkItemStatus);
    workItem = await getWorkItemById(tx, parseInt(id, 10));
    log.debug('Got work item');
    const job: Job = await Job.byJobID(tx, workItem.jobID);
    // If the response is an error then set the job status to 'failed'
    if (workItem.status === WorkItemStatus.FAILED) {
      if (job.status !== JobStatus.FAILED) {
        job.status = JobStatus.FAILED;
        let message: string;
        if (errorMessage) {
          message = `WorkItem [${workItem.id}] failed with error: ${errorMessage}`;
        } else {
          message = 'Unknown error';
        }
        job.message = message;
        await job.save(tx);
      }
    } else if (results) {
      const nextStep = await getWorkflowStepByJobIdStepIndex(
        tx,
        workItem.jobID,
        workItem.workflowStepIndex + 1,
      );

      if (nextStep) {
        // Create a new work item for each result using the next step
        for await (const result of results) {
          const newWorkItem = new WorkItem({
            jobID: workItem.jobID,
            serviceID: nextStep.serviceID,
            status: WorkItemStatus.READY,
            stacCatalogLocation: result,
            workflowStepIndex: nextStep.stepIndex,
          });

          await newWorkItem.save(tx);
        }

        // If the current step is the query-cmr service and the number of work items for the next
        // step is less than 'workItemCount' for the next step then create a new work item for
        // the current step
        const workItemCount = await workItemCountForStep(tx, workItem.jobID, nextStep.stepIndex);
        if (workItem.scrollID && workItemCount < nextStep.workItemCount) {
          const newWorkItem = new WorkItem({
            jobID: workItem.jobID,
            scrollID: workItem.scrollID,
            serviceID: workItem.serviceID,
            status: WorkItemStatus.READY,
            stacCatalogLocation: workItem.stacCatalogLocation,
            workflowStepIndex: workItem.workflowStepIndex,
          });

          await newWorkItem.save(tx);
        }
      } else {
        // 1. add job links for the results
        await _handleWorkItemResults(tx, job, results);
        // 2. If the number of work items with status 'successful' equals 'workItemCount'
        //    for the current step (which is the last) then set the job status to 'complete'.
        const successWorkItemCount = await workItemCountForStep(
          tx,
          workItem.jobID,
          workItem.workflowStepIndex,
          WorkItemStatus.SUCCESSFUL,
        );
        const thisStep = await getWorkflowStepByJobIdStepIndex(
          tx,
          workItem.jobID,
          workItem.workflowStepIndex,
        );

        if (successWorkItemCount === thisStep.workItemCount) {
          job.status = JobStatus.SUCCESSFUL;
          job.message = 'Job completed successfully';
          await job.save(tx);
        }
      }
    }
  });
  res.status(204).send();
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
