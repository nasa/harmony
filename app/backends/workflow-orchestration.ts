import _, { ceil, range, sum } from 'lodash';
import { NextFunction, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { Logger } from 'winston';
import db, { batchSize, Transaction } from '../util/db';
import { completeJob } from '../util/job';
import env from '../util/env';
import { readCatalogItems, StacItemLink } from '../util/stac';
import HarmonyRequest from '../models/harmony-request';
import { Job, JobStatus } from '../models/job';
import JobLink, { getJobDataLinkCount } from '../models/job-link';
import WorkItem, { getNextWorkItem, updateWorkItemStatus, getWorkItemById, workItemCountForStep, getWorkItemsByJobIdAndStepIndex } from '../models/work-item';
import WorkflowStep, { decrementFutureWorkItemCount, getWorkflowStepByJobIdStepIndex } from '../models/workflow-steps';
import path from 'path';
import { promises as fs } from 'fs';
import { ServiceError } from '../util/errors';
import { clearScrollSession } from '../util/cmr';
import { COMPLETED_WORK_ITEM_STATUSES, WorkItemStatus } from '../models/work-item-interface';
import JobError, { getErrorCountForJob } from '../models/job-error';

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
async function addJobLinksForFinishedWorkItem(
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

  // create the directory to hold the catalog(s)
  const outputDir = path.join(env.hostVolumePath, nextStep.jobID, `aggregate-${currentWorkItem.id}`, 'outputs');
  await fs.mkdir(outputDir, { recursive: true });

  // path to use in the catalogs when generating links (correct for worker container not Harmony)
  // we don't use fs.join here because the pods use linux paths
  const containerOutputPath = `${PATH_TO_CONTAINER_ARTIFACTS}/${nextStep.jobID}/aggregate-${currentWorkItem.id}/outputs`;

  const pageSize = env.aggregateStacCatalogMaxPageSize;
  const catalogCount = ceil(itemLinks.length / env.aggregateStacCatalogMaxPageSize);
  for (const index of range(0, catalogCount)) {
    const start = index * pageSize;
    const end = start + pageSize;
    const links = itemLinks.slice(start, end);

    // and prev/next links as needed
    if (index > 0) {
      const prevCatUrl = `${containerOutputPath}/catalog${index - 1}.json`;
      const prevLink: StacItemLink = {
        href: prevCatUrl,
        rel: 'prev',
        title: 'Previous page',
        type: 'application/json',
      };
      links.push(prevLink);
    }

    if (index < catalogCount - 1) {
      const nextCatUrl = `${containerOutputPath}/catalog${index + 1}.json`;
      const nextLink: StacItemLink = {
        href: nextCatUrl,
        rel: 'next',
        title: 'Next page',
        type: 'application/json',
      };
      links.push(nextLink);
    }

    // create a STAC catalog with links
    const catalog = {
      stac_version: '1.0.0-beta.2',
      stac_extensions: [],
      id: uuid(),
      description: 'Aggregation input catalogs',
      links: links,
    };

    const catalogJson = JSON.stringify(catalog, null, 4);

    // write the new catalog out to the file system
    const catalogPath = path.join(outputDir, `catalog${index}.json`);
    await fs.writeFile(catalogPath, catalogJson);
  }

  // catalog0 is the first catalog in the linked catalogs, so it is the catalog
  // that aggregating services should read first
  // we don't use fs.join here because the pods use linux paths
  const podCatalogPath = `${containerOutputPath}/catalog0.json`;

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
  tx: Transaction, workItem: WorkItem, allWorkItemsForStepComplete: boolean, results: string[],
): Promise<WorkflowStep> {
  const nextStep = await getWorkflowStepByJobIdStepIndex(
    tx, workItem.jobID, workItem.workflowStepIndex + 1,
  );

  if (nextStep) {
    if (results && results.length > 0) {
      // if we have completed all the work items for this step or if the next step does not
      // aggregate then create a work item for the next step
      if (nextStep.hasAggregatedOutput) {
        if (allWorkItemsForStepComplete) {
          await createAggregatingWorkItem(tx, workItem, nextStep);
        }
      } else {
        // Create a new work item for each result using the next step
        const newItems = results.map(result =>
          new WorkItem({
            jobID: workItem.jobID,
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
  }
  return nextStep;
}

/**
 * Creates another next query-cmr work item if needed
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 */
async function maybeQueueQueryCmrWorkItem(
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
 * If a work item has an error adds the error to the job_errors database table.
 *
 * @param tx - The database transaction
 * @param job - The job record
 * @param url - The URL to include in the error
 * @param message - An error message to include in the error
 */
async function addErrorForWorkItem(
  tx: Transaction, job: Job, url: string, message: string,
): Promise<void> {
  const error = new JobError({
    jobID: job.jobID,
    url,
    message,
  });
  await error.save(tx);
}

/**
 * Returns the final job status for the request based on whether all items were
 * successful, some were successful and some failed, or all items failed.
 *
 * @param tx - The database transaction
 * @param job - The job record
 * @returns the final job status for the request
 */
async function getFinalStatusForJob(tx: Transaction, job: Job): Promise<JobStatus> {
  let finalStatus = JobStatus.SUCCESSFUL;
  if (await getErrorCountForJob(tx, job.jobID) > 0) {
    if (await getJobDataLinkCount(tx, job.jobID) > 0) {
      finalStatus = JobStatus.COMPLETE_WITH_ERRORS;
    } else {
      finalStatus = JobStatus.FAILED;
    }
  }
  return finalStatus;
}

/**
 * Returns a URL for the work item which will be stored with a job error.
 *
 * @param workItem - The work item
 * @param logger - The logger for the request
 *
 * @returns a relevant URL for the work item that failed if a data URL exists
 */
function getWorkItemUrl(workItem, logger): string {
  let url = 'unknown';
  const localLocation = workItem.stacCatalogLocation?.replace(PATH_TO_CONTAINER_ARTIFACTS, env.hostVolumePath);

  if (localLocation) {
    try {
      const items = readCatalogItems(localLocation);
      // Only consider the first item in the list
      url = items[0].assets.data.href;
    } catch (e) {
      logger.error('Could not read catalog');
      logger.error(e);
    }
  }

  return url;
}

/**
 * Checks if the work item failed and if so handles the logic of determining whether to
 * fail the job or continue to processing. If there's an error it adds it to the job_errors
 * table.
 *
 * @param tx - The database transaction
 * @param job - The job associated with the work item
 * @param workItem - The work item that just finished
 * @param workflowStep - The current workflow step
 * @param status - The status sent with the work item update
 * @param errorMessage - The error message associated with the work item update (if any)
 * @param logger - The logger for the request
 *
 * @returns whether to continue processing work item updates or end
 */
async function handleFailedWorkItems(
  tx, job, workItem: WorkItem, workflowStep: WorkflowStep, status, logger, errorMessage,
): Promise<boolean> {
  let continueProcessing = true;
  // If the response is an error then set the job status to 'failed'
  if (status === WorkItemStatus.FAILED) {
    continueProcessing = job.ignoreErrors;
    if (![JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
      let jobMessage;
      if (workItem.scrollID) {
        // Fail the request if query-cmr fails to populate granules
        continueProcessing = false;
        jobMessage = `WorkItem [${workItem.id}] failed to query CMR for granule information`;
        if (errorMessage) {
          jobMessage = `${jobMessage} with error: ${errorMessage}`;
        }
      } else {
        const url = getWorkItemUrl(workItem, logger);

        let message = `WorkItem [${workItem.id}] failed with an unknown error`;
        if (errorMessage) {
          message = `WorkItem [${workItem.id}] failed with error: ${errorMessage}`;
        }
        await addErrorForWorkItem(tx, job, url, message);
      }

      if (job.ignoreErrors && !jobMessage) {
        const errorCount =  await getErrorCountForJob(tx, job.jobID);
        if (errorCount > env.maxErrorsForJob) {
          jobMessage = `Maximum allowed errors ${env.maxErrorsForJob} exceeded`;
          continueProcessing = false;
        }
      }

      if (!continueProcessing) {
        await completeJob(tx, job, JobStatus.FAILED, logger, jobMessage);
      } else {
        // Need to make sure we expect one fewer granule to complete
        await decrementFutureWorkItemCount(tx, job.jobID, workflowStep.stepIndex);
      }
    }
  }
  return continueProcessing;
}

/**
 * Clears the CMR scrolling session if the work item has a scroll ID and the work item
 * failed or has scrolled through the expected number of items.
 *
 * @param workflowStep - The current workflow step
 * @param status - The work item status
 * @param scrollID - The scrollID for the work item (may be null)
 */
async function maybeClearScrollSession(
  scrollID: string, allWorkItemsForStepComplete: boolean, status: WorkItemStatus,
): Promise<void> {
  if (scrollID) {
    if (allWorkItemsForStepComplete || status === WorkItemStatus.FAILED) {
      await clearScrollSession(scrollID);
    }
  }
}

/**
 * Update a work item from a service response
 *
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
  let responded = false;
  await db.transaction(async (tx) => {
    const workItem = await getWorkItemById(tx, parseInt(id, 10));
    const job = await Job.byJobID(tx, workItem.jobID, false, false);
    const thisStep = await getWorkflowStepByJobIdStepIndex(tx, workItem.jobID, workItem.workflowStepIndex);

    // If the job was already canceled or failed then send 409 response
    if ([JobStatus.FAILED, JobStatus.CANCELED].includes(job.status)) {
      res.status(409).send(`Job was already ${job.status}.`);
      // Note work item will stay in the running state, but the reaper will clean it up
      responded = true;
      return;
    }

    await updateWorkItemStatus(tx, id, status as WorkItemStatus, totalGranulesSize);
    const completedWorkItemCount = await workItemCountForStep(
      tx, workItem.jobID, workItem.workflowStepIndex, COMPLETED_WORK_ITEM_STATUSES,
    );
    const allWorkItemsForStepComplete = (completedWorkItemCount == thisStep.workItemCount);

    await maybeClearScrollSession(workItem.scrollID, allWorkItemsForStepComplete, status);
    const continueProcessing = await handleFailedWorkItems(tx, job, workItem, thisStep, status, logger, errorMessage);

    if (continueProcessing) {
      let nextStep = null;
      if (status != WorkItemStatus.FAILED) {
        nextStep = await createNextWorkItems(tx, workItem, allWorkItemsForStepComplete, results);
      }

      if (nextStep) {
        if (results && results.length > 0) {
          await maybeQueueQueryCmrWorkItem(tx, workItem, nextStep);
        } else {
          // Failed to create the next work items - fail the job rather than leaving it orphaned
          // in the running state
          logger.error('The work item update should have contained results to queue a next work item, but it did not.');
          const message = 'Harmony internal failure: could not create the next work items for the request.';
          await completeJob(tx, job, JobStatus.FAILED, logger, message);
        }
      } else {
        // Finished with the chain for this granule
        if (status != WorkItemStatus.FAILED) {
          await addJobLinksForFinishedWorkItem(tx, job, results, logger);
        }
        // If all granules are finished mark the job as finished
        job.completeBatch(thisStep.workItemCount);
        if (allWorkItemsForStepComplete) {
          const finalStatus = await getFinalStatusForJob(tx, job);
          await completeJob(tx, job, finalStatus, logger);
        } else {
          // Special case to pause the job as soon as any single granule completes when in the previewing state
          if (job.status === JobStatus.PREVIEWING) {
            job.pause();
          }
          await job.save(tx);
        }
      }
    }
  });
  if (!responded) {
    // If we haven't returned an error to the caller already return a success with no body
    res.status(204).send();
  }
}
