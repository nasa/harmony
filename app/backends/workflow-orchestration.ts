import _, { sum } from 'lodash';
import { NextFunction, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { Logger } from 'winston';
import db, { batchSize, Transaction } from '../util/db';
import { completeJob } from '../util/job';
import env from '../util/env';
import { readCatalogItems, StacItemLink } from '../util/stac';
import HarmonyRequest from '../models/harmony-request';
import { Job, JobStatus } from '../models/job';
import JobLink from '../models/job-link';
import WorkItem, { getNextWorkItem, updateWorkItemStatus, getWorkItemById, workItemCountForStep, getWorkItemsByJobIdAndStepIndex } from '../models/work-item';
import WorkflowStep, { getWorkflowStepByJobIdStepIndex } from '../models/workflow-steps';
import path from 'path';
import { promises as fs } from 'fs';
import { ServiceError } from '../util/errors';
import { clearScrollSession } from '../util/cmr';
import { SUCCESSFUL_WORK_ITEM_STATUSES, WorkItemStatus } from '../models/work-item-interface';

const MAX_TRY_COUNT = 1;
const RETRY_DELAY = 1000;
// Must match where the service wrapper is mounting artifacts
export const PATH_TO_CONTAINER_ARTIFACTS = '/tmp/metadata';

/**
 * Calculate the granule page limit for the current query-cmr work item.
 * @param workItem - current query-cmr work item
 * @param tx - database transaction to query with
 * @param logger - a Logger instance
 * @returns a number used to limit the query-cmr task or undefined
 */
async function calculateQueryCmrLimit(
  workItem: WorkItem,
  tx,
  logger: Logger): Promise<number> {
  if (workItem?.scrollID) { // only proceed if this is a query-cmr step
    const { numInputGranules } = await Job.byJobID(tx, workItem.jobID, false, false);
    let queryCmrItems = (await getWorkItemsByJobIdAndStepIndex(
      tx, workItem.jobID, workItem.workflowStepIndex, 1, Number.MAX_SAFE_INTEGER))
      .workItems;
    queryCmrItems = queryCmrItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL);
    const stacCatalogLengths = await Promise.all(queryCmrItems.map(async ({ id, jobID }) => {
      try {
        const directory = path.join(env.hostVolumePath, jobID, `${id}`, 'outputs');
        const jsonPath = path.join(directory, 'batch-catalogs.json');
        const json = (await fs.readFile(jsonPath)).toString();
        return JSON.parse(json).length;
      } catch (e) {
        logger.error(e);
        return 0;
      }
    }));
    const queryCmrLimit = numInputGranules - sum(stacCatalogLengths);
    logger.debug(`Limit next query-cmr task to no more than ${queryCmrLimit} granules.`);
    return queryCmrLimit;
  }
}

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
  const { logger } = req.context;
  const { serviceID } = req.query;
  let workItem: WorkItem, maxCmrGranules: number;
  await db.transaction(async (tx) => {
    workItem = await getNextWorkItem(tx, serviceID as string);
    maxCmrGranules = await calculateQueryCmrLimit(workItem, tx, logger);
  });
  if (workItem) {
    res.send({ workItem, maxCmrGranules });
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
      for (const keyValue of Object.entries(item.assets)) {
        const asset = keyValue[1];
        const { href, type, title } = asset;
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
}

/**
 * Read a STAC catalog and return the item links. This does not handle sub-catalogs. This function
 * makes assumptions based on the Harmony STAC directory layout for services inputs/outputs and
 * is only intended to be used when aggregating service outputs into a single catalog.
 * @param catalogPath - the path to the catalog
 */
async function getItemLinksFromCatalog(catalogPath: string): Promise<StacItemLink[]> {
  const baseDir = path.dirname(catalogPath).replace(env.hostVolumePath, PATH_TO_CONTAINER_ARTIFACTS);
  const text = (await fs.readFile(catalogPath)).toString();
  const catalog = JSON.parse(text);
  const links: StacItemLink[] = [];
  for (const link of catalog.links) {
    if (link.rel === 'item') {
      // make relative path absolute
      const { href } = link;
      link.href = `${baseDir}/${path.normalize(href)}`;
      links.push(link);
    }
  }

  return links;
}

/**
 * Creates a work item that uses all the output of the previous step. This function assumes that
 * all work items for the previous step are completed. It also relies on the convention that
 * services write out their results as STAC catalogs with the following path
 * `/tmp/<JOB_ID>/<WORK_ITEM_ID>/outputs/catalog.json`
 *                       OR
 * `/tmp/<JOB_ID>/<WORK_ITEM_ID>/outputs/catalogN.json` (when a step can generate multiple outputs)
 * where N is from 0 to the number of results - 1.
 *
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 * @param results - an array of paths to STAC catalogs from the last worked item
 */
async function createAggregatingWorkItem(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep,
): Promise<void> {
  const itemLinks: StacItemLink[] = [];
  // get all the previous results
  const workItemCount = await workItemCountForStep(tx, currentWorkItem.jobID, nextStep.stepIndex - 1);
  let page = 1;
  let processedItemCount = 0;
  while (processedItemCount < workItemCount) {
    const prevStepWorkItems = await getWorkItemsByJobIdAndStepIndex(tx, currentWorkItem.jobID, nextStep.stepIndex - 1, page);
    // guard against failure case where we cannot retrieve all items - THIS SHOULD NEVER HAPPEN
    if (prevStepWorkItems.workItems.length < 1) break;

    for (const workItem of prevStepWorkItems.workItems) {
      const { id, jobID } = workItem;
      const directory = path.join(env.hostVolumePath, jobID, `${id}`, 'outputs');
      try {
        // try to use the default catalog output for single granule work items
        const singleCatalogPath = path.join(directory, 'catalog.json');
        const newLinks = await getItemLinksFromCatalog(singleCatalogPath);
        itemLinks.push(...newLinks);
      } catch {
        // couldn't read the single catalog so read the JSON file that lists all the result
        // catalogs for this work item
        const jsonPath = path.join(directory, 'batch-catalogs.json');
        const json = (await fs.readFile(jsonPath)).toString();
        const catalog = JSON.parse(json);
        for (const filePath of catalog) {
          const fullPath = path.join(directory, filePath);
          const newLinks = await getItemLinksFromCatalog(fullPath);
          itemLinks.push(...newLinks);
        }
      }

      processedItemCount++;
    }
    page++;
  }

  // if we could not pull back all the work items we expected then something went wrong
  if (processedItemCount < workItemCount) {
    throw new ServiceError(500, `Failed to retrieve all work items for step ${nextStep.stepIndex - 1}`);
  }

  // create a STAC catalog using `catalogLinks`
  const catalog = {
    stac_version: '1.0.0-beta.2',
    stac_extensions: [],
    id: uuid(),
    description: 'Aggregation input catalogs',
    links: itemLinks,
  };

  const catalogJson = JSON.stringify(catalog, null, 4);
  // write the new catalog out to the file system
  const outputDir = path.join(env.hostVolumePath, nextStep.jobID, `aggregate-${currentWorkItem.id}`, 'outputs');
  await fs.mkdir(outputDir, { recursive: true });
  const catalogPath = path.join(outputDir, 'catalog0.json');
  await fs.writeFile(catalogPath, catalogJson);

  // we don't use fs.join here because the pods use linux paths
  const podCatalogPath = `${PATH_TO_CONTAINER_ARTIFACTS}/${nextStep.jobID}/aggregate-${currentWorkItem.id}/outputs/catalog0.json`;

  const newWorkItem = new WorkItem({
    jobID: currentWorkItem.jobID,
    serviceID: nextStep.serviceID,
    status: WorkItemStatus.READY,
    stacCatalogLocation: podCatalogPath,
    workflowStepIndex: nextStep.stepIndex,
  });

  await newWorkItem.save(tx);
}

/**
 * Creates the next work items for the workflow based on the results of the current step
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 * @param results - an array of paths to STAC catalogs
 */
async function createNextWorkItems(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep, results: string[],
): Promise<void> {
  if (nextStep.hasAggregatedOutput) {
    await createAggregatingWorkItem(tx, currentWorkItem, nextStep);
  } else {
    // Create a new work item for each result using the next step
    const newItems = results.map(result =>
      new WorkItem({
        jobID: currentWorkItem.jobID,
        serviceID: nextStep.serviceID,
        status: WorkItemStatus.READY,
        stacCatalogLocation: result,
        workflowStepIndex: nextStep.stepIndex,
      }),
    );
    for (const batch of _.chunk(newItems, batchSize)) {
      await WorkItem.insertBatch(tx, batch);
    }
  }
}

/**
 * Creates another next query-cmr work item if needed
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 */
async function handleQueryCmrWork(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep,
): Promise<void> {
  if (currentWorkItem.scrollID) {
    // If the current step is the query-cmr service and the number of work items for the next
    // step is less than 'workItemCount' for the next step then create a new work item for
    // the current step
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
  const totalGranulesSize = req.body.totalGranulesSize ? parseFloat(req.body.totalGranulesSize) : 0;
  const { logger } = req.context;
  logger.info(`Updating work item for ${id} to ${status}`);
  await db.transaction(async (tx) => {
    const workItem = await getWorkItemById(tx, parseInt(id, 10));
    const job: Job = await Job.byJobID(tx, workItem.jobID, false, true);
    const thisStep = await getWorkflowStepByJobIdStepIndex(tx, workItem.jobID, workItem.workflowStepIndex);
    const isQueryCmr = workItem.serviceID.match(/query-cmr/);

    // If the job was already canceled or failed then send 400 response
    if ([JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
      res.status(409).send(`Job was already ${job.status}.`);
      // TODO investigate whether or not returning here could lead to work items staying in the 'running' state
      return;
    }

    await updateWorkItemStatus(tx, id, status as WorkItemStatus, totalGranulesSize);
    // If the response is an error then set the job status to 'failed'
    if (status === WorkItemStatus.FAILED) {
      if (![JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
        if (isQueryCmr) {
          await clearScrollSession(workItem.scrollID);
        }
        let message = 'Unknown error';
        if (errorMessage) {
          message = `WorkItem [${workItem.id}] failed with error: ${errorMessage}`;
        }
        await completeJob(tx, job, JobStatus.FAILED, logger, message);
      }
    } else {
      const nextStep = await getWorkflowStepByJobIdStepIndex(
        tx,
        workItem.jobID,
        workItem.workflowStepIndex + 1,
      );

      const successWorkItemCount = await workItemCountForStep(
        tx,
        workItem.jobID,
        workItem.workflowStepIndex,
        SUCCESSFUL_WORK_ITEM_STATUSES,
      );

      if (isQueryCmr && successWorkItemCount === thisStep.workItemCount) {
        await clearScrollSession(workItem.scrollID);
      }

      if (nextStep) {
        if (results && results.length > 0) {
          // if we have completed all the work items for this step or if the next step does not
          // aggregate then create a work item for the next step
          if (successWorkItemCount === thisStep.workItemCount || !nextStep.hasAggregatedOutput) {
            await createNextWorkItems(tx, workItem, nextStep, results);
          }
          await handleQueryCmrWork(tx, workItem, nextStep);
        } else {
          // Failed to create the next work items - fail the job rather than leaving it orphaned
          // in the running state
          logger.error('The work item update should have contained results to queue a next work item, but it did not.');
          const message = 'Harmony internal failure: could not create the next work items for the request.';
          await completeJob(tx, job, JobStatus.FAILED, logger, message);
        }
      } else {
        // 1. add job links for the results
        await _handleWorkItemResults(tx, job, results, logger);
        // 2. If the number of work items with status 'successful' equals 'workItemCount'
        //    for the current step (which is the last) then set the job status to 'complete'.
        job.completeBatch(thisStep.workItemCount);
        if (successWorkItemCount === thisStep.workItemCount) {
          await completeJob(tx, job, JobStatus.SUCCESSFUL, logger);
        } else {
          if (job.status === JobStatus.PREVIEWING) {
            job.pause();
          }
          await job.save(tx);
        }
      }
    }
  });
  res.status(204).send();
}
