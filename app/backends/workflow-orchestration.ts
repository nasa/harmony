import { NextFunction, Response } from 'express';
import db, { Transaction } from '../util/db';
import env from '../util/env';
import { readCatalogItems } from '../util/stac';
import HarmonyRequest from '../models/harmony-request';
import { Job, JobStatus } from '../models/job';
import JobLink from '../models/job-link';
import WorkItem, { getNextWorkItem, WorkItemStatus, updateWorkItemStatus, getWorkItemById, workItemCountForStep } from '../models/work-item';
import { getWorkflowStepByJobIdStepIndex } from '../models/workflow-steps';
import log from '../util/log';

const MAX_TRY_COUNT = 1;
const RETRY_DELAY = 1000;

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
  const { logger } = req.context;
  if (tryCount === 1) {
    logger.debug(`Getting work for service [${serviceID}]`);
  }
  let workItem;
  await db.transaction(async (tx) => {
    workItem = await getNextWorkItem(tx, serviceID as string);
  });
  if (workItem) {
    res.send(workItem);
  } else if (tryCount < MAX_TRY_COUNT) {
    setTimeout(async () => {
      getWork(req, res, next, tryCount + 1);
    }, RETRY_DELAY);
  } else {
    res.status(404).send();
  }
}

/**
 * Update a work item from a service response - TODO route just for test purposes can
 * delete before merging in HARMONY-804 branch
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function createWorkItem(req: HarmonyRequest, res: Response): Promise<void> {
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
 * Add links to the Job for the WorkItem and save them to the database.
 *
 * @param workItem - The work item associated with the results
 * @param results  - an array of paths to STAC catalogs
 */
async function _handleWorkItemResults(
  tx: Transaction,
  job: Job,
  results: string[],
): Promise<void> {
  for (const catalogLocation of results) {
    const localLocation = catalogLocation.replace('/tmp/metadata', env.hostVolumePath);
    log.debug(`Adding link for STAC catalog ${localLocation}`);

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
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function updateWorkItem(req: HarmonyRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, results, errorMessage } = req.body;
  log.info(`Updating work item for ${id} to ${status}`);
  let workItem: WorkItem;
  await db.transaction(async (tx) => {
    await updateWorkItemStatus(tx, id, status as WorkItemStatus);
    workItem = await getWorkItemById(tx, parseInt(id, 10));
    const job: Job = await Job.byJobID(tx, workItem.jobID);
    // If the response is an error then set the job status to 'failed'
    if (workItem.status === WorkItemStatus.FAILED) {
      if (![JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
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
        if (workItem.scrollID) {
          const workItemCount = await workItemCountForStep(tx, workItem.jobID, nextStep.stepIndex);
          if (workItemCount < nextStep.workItemCount) {
            const nextQueryCmrItem = new WorkItem({
              jobID: workItem.jobID,
              scrollID: workItem.scrollID,
              serviceID: workItem.serviceID,
              status: WorkItemStatus.READY,
              stacCatalogLocation: workItem.stacCatalogLocation,
              workflowStepIndex: workItem.workflowStepIndex,
            });

            await nextQueryCmrItem.save(tx);
          }
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

        job.updateProgress(results.length, thisStep.workItemCount);
        if (successWorkItemCount === thisStep.workItemCount) {
          job.succeed();
        }
        await job.save(tx);
      }
    }
  });
  res.status(204).send();
}
