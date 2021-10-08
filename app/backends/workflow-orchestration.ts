import { NextFunction, Response } from 'express';
import { Logger } from 'winston';
import db, { Transaction } from '../util/db';
import { completeJob } from '../util/job';
import env from '../util/env';
import { readCatalogItems } from '../util/stac';
import HarmonyRequest from '../models/harmony-request';
import { Job, JobStatus } from '../models/job';
import JobLink from '../models/job-link';
import WorkItem, { getNextWorkItem, WorkItemStatus, updateWorkItemStatus, getWorkItemById, workItemCountForStep } from '../models/work-item';
import WorkflowStep, { getWorkflowStepByJobIdStepIndex } from '../models/workflow-steps';

const MAX_TRY_COUNT = 1;
const RETRY_DELAY = 1000;
// Must match where the service wrapper is mounting artifacts
const PATH_TO_CONTAINER_ARTIFACTS = '/tmp/metadata';

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
  const { serviceID } = req.query;
  let workItem;
  await db.transaction(async (tx) => {
    workItem = await getNextWorkItem(tx, serviceID as string);
  });
  if (workItem) {
    res.send(workItem);
  } else if (tryCount < MAX_TRY_COUNT) {
    setTimeout(async () => {
      await getWork(req, res, next, tryCount + 1);
    }, RETRY_DELAY);
  } else {
    res.status(404).send();
  }
}

/**
 * Add links to the Job for the WorkItem and save them to the database.
 *
 * @param tx - The database transaction
 * @param job - The job for the work item
 * @param results  - an array of paths to STAC catalogs
 * @param logger - The logger for the request
 */
async function _handleWorkItemResults(
  tx: Transaction,
  job: Job,
  results: string[],
  logger: Logger,
): Promise<void> {
  for (const catalogLocation of results) {
    const localLocation = catalogLocation.replace(PATH_TO_CONTAINER_ARTIFACTS, env.hostVolumePath);
    logger.debug(`Adding link for STAC catalog ${localLocation}`);

    const items = readCatalogItems(localLocation);

    for await (const item of items) {
      const { href, type, title } = item.assets.data;
      const link = new JobLink({
        jobID: job.jobID,
        href,
        type,
        title,
        rel: 'data',
        temporal: {
          start: new Date(item.properties.start_datetime),
          end: new Date(item.properties.end_datetime),
        },
        bbox: item.bbox,
      });
      await link.save(tx);
    }
  }
}

/**
 * Creates the next work items for the workflow based on the results of the current step
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 * @param results - an array of paths to STAC catalogs
 */
async function _createNextWorkItems(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep, results: string[],
): Promise<void> {
  // Create a new work item for each result using the next step
  for await (const result of results) {
    const newWorkItem = new WorkItem({
      jobID: currentWorkItem.jobID,
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
  if (currentWorkItem.scrollID) {
    const workItemCount = await workItemCountForStep(tx, currentWorkItem.jobID, nextStep.stepIndex);
    if (workItemCount < nextStep.workItemCount) {
      const nextQueryCmrItem = new WorkItem({
        jobID: currentWorkItem.jobID,
        scrollID: currentWorkItem.scrollID,
        serviceID: currentWorkItem.serviceID,
        status: WorkItemStatus.READY,
        stacCatalogLocation: currentWorkItem.stacCatalogLocation,
        workflowStepIndex: currentWorkItem.workflowStepIndex,
      });

      await nextQueryCmrItem.save(tx);
    }
  }
}
/**
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function updateWorkItem(req: HarmonyRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, results, errorMessage } = req.body;
  const { logger } = req.context;
  logger.info(`Updating work item for ${id} to ${status}`);
  await db.transaction(async (tx) => {
    const workItem = await getWorkItemById(tx, parseInt(id, 10));
    const job: Job = await Job.byJobID(tx, workItem.jobID);
    // If the job was already canceled or failed then send 400 response
    if ([JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
      res.status(409).send(`Job was already ${job.status}.`);
      return;
    }
    await updateWorkItemStatus(tx, id, status as WorkItemStatus);
    // If the response is an error then set the job status to 'failed'
    if (status === WorkItemStatus.FAILED) {
      if (![JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
        let message = 'Unknown error';
        if (errorMessage) {
          message = `WorkItem [${workItem.id}] failed with error: ${errorMessage}`;
        }
        await completeJob(tx, job, JobStatus.FAILED, logger, message);
      }
    } else if (results) {
      const nextStep = await getWorkflowStepByJobIdStepIndex(
        tx,
        workItem.jobID,
        workItem.workflowStepIndex + 1,
      );

      if (nextStep) {
        await _createNextWorkItems(tx, workItem, nextStep, results);
      } else {
        // 1. add job links for the results
        await _handleWorkItemResults(tx, job, results, logger);
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

        job.completeBatch(thisStep.workItemCount);
        if (successWorkItemCount === thisStep.workItemCount) {
          await completeJob(tx, job, JobStatus.SUCCESSFUL, logger);
        } else {
          await job.save(tx);
        }
      }
    }
  });
  res.status(204).send();
}
