import _, { ceil, range, sum } from 'lodash';
import { v4 as uuid } from 'uuid';
import { Logger } from 'winston';

import {
  calculateQueryCmrLimit, QUERY_CMR_SERVICE_REGEX,
} from '../../backends/workflow-orchestration/util';
import { makeWorkScheduleRequest } from '../../backends/workflow-orchestration/work-item-polling';
import { Job, JobStatus } from '../../models/job';
import JobLink, { getJobDataLinkCount } from '../../models/job-link';
import JobMessage, {
  getErrorMessagesForJob, getMessageCountForJob, getWarningMessagesForJob, JobMessageLevel,
} from '../../models/job-message';
import {
  decrementRunningCount, deleteUserWorkForJob, deleteUserWorkForJobAndService,
  incrementReadyAndDecrementRunningCounts, incrementReadyCount, setReadyCountToZero,
} from '../../models/user-work';
import WorkItem, {
  getWorkItemById, getWorkItemsByJobIdAndStepIndex, maxSortIndexForJobService, updateWorkItemStatus,
  workItemCountForStep,
} from '../../models/work-item';
import { COMPLETED_WORK_ITEM_STATUSES, WorkItemStatus } from '../../models/work-item-interface';
import WorkItemUpdate from '../../models/work-item-update';
import WorkflowStep, {
  getWorkflowStepByJobIdStepIndex, updateIsComplete,
} from '../../models/workflow-steps';
import { handleBatching, outputStacItemUrls, resultItemSizes } from '../../util/aggregation-batch';
import db, { batchSize, Transaction } from '../../util/db';
import env from '../../util/env';
import { ServerError, ServiceError } from '../../util/errors';
import { completeJob } from '../../util/job';
import { logAsyncExecutionTime } from '../../util/log-execution';
import { objectStoreForProtocol } from '../../util/object-store';
import {
  readCatalogItems, readCatalogsItems, StacCatalog, StacItem, StacItemLink,
} from '../../util/stac';
import { resolve } from '../../util/url';

/**
 * A structure holding the preprocess info of a work item
 */
export type WorkItemPreprocessInfo = {
  status?: WorkItemStatus;
  catalogItems: StacItem[];
  outputItemSizes: number[];
};

export type WorkItemUpdateQueueItem = {
  update: WorkItemUpdate,
  operation?: object,
  preprocessResult?: WorkItemPreprocessInfo,
};

/**
 * Add links to the Job for the WorkItem and save them to the database.
 *
 * @param tx - The database transaction
 * @param jobID - The job ID for the work item
 * @param catalogItems - an array of STAC catalog items
 */
async function addJobLinksForFinishedWorkItem(
  tx: Transaction,
  jobID: string,
  catalogItems: StacItem[],
): Promise<void> {
  for await (const item of catalogItems) {
    for (const keyValue of Object.entries(item.assets)) {
      const asset = keyValue[1];
      const { href, type, title } = asset;
      const link = new JobLink({
        jobID,
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
 * Returns the final job status and message for the request based on whether all
 * items were successful, some were successful and some failed, or all items failed.
 * This function is not reached in all job completion failure cases
 * (e.g. error limit exceeded, ignore errors is false, query cmr fails)
 *
 * @param tx - The database transaction
 * @param job - The job record
 * @returns the final job status for the request
 */
async function getFinalStatusAndMessageForJob(tx: Transaction, job: Job):
Promise<{ finalStatus: JobStatus, finalMessage: string; }> {
  let finalStatus = JobStatus.SUCCESSFUL;
  const errorCount = await getMessageCountForJob(tx, job.jobID, JobMessageLevel.ERROR);
  const warningCount = await getMessageCountForJob(tx, job.jobID, JobMessageLevel.WARNING);
  const dataLinkCount = await getJobDataLinkCount(tx, job.jobID);
  if (errorCount > 0) {
    if (dataLinkCount > 0) {
      finalStatus = JobStatus.COMPLETE_WITH_ERRORS;
    } else {
      finalStatus = JobStatus.FAILED;
    }
  } else if (warningCount > 0) {
    finalStatus = JobStatus.SUCCESSFUL;
  }

  let finalMessage = '';
  if ((errorCount > 1) && (finalStatus == JobStatus.FAILED)) {
    finalMessage = `The job failed with ${errorCount} errors and ${warningCount} warnings. See the errors and warnings fields of the job status page for more details.`;
  } else if ((errorCount == 1) && (finalStatus == JobStatus.FAILED)) {
    const jobError = (await getErrorMessagesForJob(tx, job.jobID, 1))[0];
    finalMessage = jobError.message;
  } else if ((warningCount > 1) && (finalStatus == JobStatus.SUCCESSFUL)) {
    finalMessage = `The job succeeded with ${warningCount} warnings. See the warnings field of the job status page for more details.`;
  } else if ((warningCount == 1) && (finalStatus == JobStatus.SUCCESSFUL)) {
    const jobWarning = (await getWarningMessagesForJob(tx, job.jobID, 1))[0];
    finalMessage = jobWarning.message;
  }
  return { finalStatus, finalMessage };
}

/**
 * If a work item has a message adds the message to the job_messages database table.
 *
 * @param tx - The database transaction
 * @param job - The job record
 * @param url - The URL to include in the error
 * @param message - An message to include in the job message ss
 * @param level - The optional message level (default 'error')
 * @param message_category - The optional category of the message
 */
async function addJobMessageForWorkItem(
  tx: Transaction,
  job: Job,
  url: string,
  message: string,
  level: JobMessageLevel = JobMessageLevel.ERROR,
  message_category?: string,
): Promise<void> {
  const jobMessage = new JobMessage({
    jobID: job.jobID,
    url,
    message,
    level,
    message_category,
  });
  await jobMessage.save(tx);
}


/**
 * Returns a URL for the work item which will be stored with a job error.
 *
 * @param workItem - The work item
 * @param logger - The logger for the request
 *
 * @returns a relevant URL for the work item that failed if a data URL exists
 */
async function getWorkItemUrl(workItem, logger): Promise<string> {
  let url = 'unknown';
  if (workItem.stacCatalogLocation) {
    try {
      const items = await readCatalogItems(workItem.stacCatalogLocation);
      // Only consider the first item in the list
      url = items[0].assets.data.href;
    } catch (e) {
      logger.error(`Could not read catalog for ${workItem.stacCatalogLocation}`);
      logger.error(e);
    }
  }

  return url;
}

/**
 * Checks if the work item failed and if so handles the logic of determining whether to
 * fail the job or continue to processing. If there's an error it adds it to the job_messages
 * table.
 *
 * @param tx - The database transaction
 * @param job - The job associated with the work item
 * @param workItem - The work item that just finished
 * @param status - The status sent with the work item update
 * @param errorMessage - The error message associated with the work item update (if any)
 * @param logger - The logger for the request
 *
 * @returns whether to continue processing work item updates or end
 */
async function handleFailedWorkItems(
  tx: Transaction, job: Job, workItem: WorkItem, status: WorkItemStatus,
  logger: Logger, errorMessage: string,
): Promise<boolean> {
  let continueProcessing = true;
  if (status === WorkItemStatus.FAILED || status === WorkItemStatus.WARNING) {
    continueProcessing = job.ignoreErrors;
    if (!job.hasTerminalStatus()) {
      let jobMessage;
      if (errorMessage) {
        let failedOrWarned = 'failed';
        if (status === WorkItemStatus.WARNING) {
          failedOrWarned = 'warned';
        }
        jobMessage = `WorkItem ${failedOrWarned}: ${errorMessage}`;
      }

      if (QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
        // Fail the request if query-cmr fails to populate granules
        continueProcessing = false;
        if (!jobMessage) {
          jobMessage = 'Failed to query CMR for granule information';
        }
      } else {
        const url = await getWorkItemUrl(workItem, logger);
        if (!jobMessage) {
          jobMessage = 'WorkItem failed with an unknown error';
        }

        let level: JobMessageLevel;
        switch (status) {
          case WorkItemStatus.FAILED:
            level = JobMessageLevel.ERROR;
            break;
          case WorkItemStatus.WARNING:
            level = JobMessageLevel.WARNING;
            break;
        }
        await addJobMessageForWorkItem(tx, job, url, jobMessage, level, workItem.message_category);
      }

      if (status === WorkItemStatus.WARNING) {
        // always continue processing for warning work item
        continueProcessing = true;
      } else {
        if (continueProcessing) {
          const errorCount = await getMessageCountForJob(tx, job.jobID);
          if (errorCount > env.maxErrorsForJob) {
            jobMessage = `Maximum allowed errors ${env.maxErrorsForJob} exceeded. See the errors fields for more details`;
            logger.warn(jobMessage);
            continueProcessing = false;
          } else if (100.0 * errorCount / job.numInputGranules > env.maxPercentErrorsForJob) {
            jobMessage = `${env.maxPercentErrorsForJob} percent maximum errors exceeded. See the errors fields for more details`;
            logger.warn(jobMessage);
            continueProcessing = false;
          }
        }

        if (!continueProcessing) {
          await completeJob(tx, job, JobStatus.FAILED, logger, jobMessage);
        } else {
          if (job.status == JobStatus.RUNNING) {
            job.status = JobStatus.RUNNING_WITH_ERRORS;
            await job.save(tx);
          }
        }
      }
    }
  }
  return continueProcessing;
}

/**
 * Updated the query-cmr workflow step's `workItemCount` field for the given job to match the new
 * granule count
 *
 * @param transaction - the transaction to use for the update
 * @param job - A Job that has a new input granule count
 */
async function updateCmrWorkItemCount(
  transaction: Transaction,
  job: Job):
  Promise<void> {
  const step = await getWorkflowStepByJobIdStepIndex(transaction, job.jobID, 1);
  step.workItemCount = Math.ceil(job.numInputGranules / env.cmrMaxPageSize);
  await step.save(transaction);
}

/**
 * Read a STAC catalog and return the item links. This does not handle sub-catalogs. This function
 * makes assumptions based on the Harmony STAC directory layout for services inputs/outputs and
 * is only intended to be used when aggregating service outputs into a single catalog.
 * @param catalogPath - the path to the catalog
 */
async function getItemLinksFromCatalog(catalogPath: string): Promise<StacItemLink[]> {
  const s3 = objectStoreForProtocol('s3');
  const catalog = await s3.getObjectJson(catalogPath) as StacCatalog;
  const links: StacItemLink[] = [];
  for (const link of catalog.links) {
    if (link.rel === 'item') {
      // make relative path absolute
      const { href } = link;
      link.href = resolve(catalogPath, href);
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
 * @param logger - the logger to use
 * @returns true if a new work item was created, false otherwise
 */
async function createAggregatingWorkItem(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep, logger: Logger,
): Promise<boolean> {
  const itemLinks: StacItemLink[] = [];
  const s3 = objectStoreForProtocol('s3');
  // get all the previous results
  // TODO if we start supporting work-item warnings that still have output data, this will need to include them as well
  const workItemCount = await workItemCountForStep(tx, currentWorkItem.jobID, nextStep.stepIndex - 1, WorkItemStatus.SUCCESSFUL);
  if (workItemCount < 1) return false; // nothing to aggregate
  let page = 1;
  let processedItemCount = 0;
  while (processedItemCount < workItemCount) {
    const prevStepWorkItems = await getWorkItemsByJobIdAndStepIndex(tx, currentWorkItem.jobID, nextStep.stepIndex - 1, page);
    // guard against failure case where we cannot retrieve all items - THIS SHOULD NEVER HAPPEN
    if (prevStepWorkItems.workItems.length < 1) break;

    // only process the successful ones
    for (const workItem of prevStepWorkItems.workItems.filter(item => item.status == WorkItemStatus.SUCCESSFUL)) {
      try {
        // try to use the default catalog output for single granule work items
        const singleCatalogPath = workItem.getStacLocation('catalog.json');
        const newLinks = await getItemLinksFromCatalog(singleCatalogPath);
        itemLinks.push(...newLinks);
      } catch {
        // couldn't read the single catalog so read the JSON file that lists all the result
        // catalogs for this work item
        const jsonPath = workItem.getStacLocation('batch-catalogs.json');
        const catalog = await s3.getObjectJson(jsonPath) as string[];
        const linksPromises: Promise<StacItemLink[]>[] = catalog.map((filename: string) => {
          const fullPath = workItem.getStacLocation(filename);
          return getItemLinksFromCatalog(fullPath);
        });
        const linksListList: StacItemLink[][] = await Promise.all(linksPromises);
        for (const linksList of linksListList) {
          itemLinks.push(...linksList);
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

  const pageSize = env.aggregateStacCatalogMaxPageSize;
  const catalogCount = ceil(itemLinks.length / env.aggregateStacCatalogMaxPageSize);
  for (const index of range(0, catalogCount)) {
    const start = index * pageSize;
    const end = start + pageSize;
    const links = itemLinks.slice(start, end);

    // and prev/next links as needed
    if (index > 0) {
      const prevCatUrl = currentWorkItem.getStacLocation(`catalog${index - 1}.json`, true);
      const prevLink: StacItemLink = {
        href: prevCatUrl,
        rel: 'prev',
        title: 'Previous page',
        type: 'application/json',
      };
      links.push(prevLink);
    }

    if (index < catalogCount - 1) {
      const nextCatUrl = currentWorkItem.getStacLocation(`catalog${index + 1}.json`, true);
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

    // write the new catalog out to s3
    const catalogPath = currentWorkItem.getStacLocation(`catalog${index}.json`, true);
    await s3.upload(catalogJson, catalogPath, null, 'application/json');
  }

  // catalog0 is the first catalog in the linked catalogs, so it is the catalog
  // that aggregating services should read first
  const podCatalogPath = currentWorkItem.getStacLocation('catalog0.json', true);

  const newWorkItem = new WorkItem({
    jobID: currentWorkItem.jobID,
    serviceID: nextStep.serviceID,
    status: WorkItemStatus.READY,
    stacCatalogLocation: podCatalogPath,
    workflowStepIndex: nextStep.stepIndex,
  });

  await incrementReadyCount(tx, currentWorkItem.jobID, nextStep.serviceID);
  await newWorkItem.save(tx);

  // ask the scheduler to schedule the new work item
  await makeWorkScheduleRequest(newWorkItem.serviceID);

  logger.info('Queued new aggregating work item.');

  return true;
}

/**
 * Creates another next query-cmr work item if needed
 * @param tx - The database transaction
 * @param currentWorkItem - The current work item
 * @param nextStep - the next step in the workflow
 */
async function maybeQueueQueryCmrWorkItem(
  tx: Transaction, currentWorkItem: WorkItem, logger: Logger,
): Promise<void> {
  // TODO HARMONY-1659 change this to handle any sequential services
  if (QUERY_CMR_SERVICE_REGEX.test(currentWorkItem.serviceID)) {
    if (await calculateQueryCmrLimit(tx, currentWorkItem, logger) > 0) {
      const nextQueryCmrItem = new WorkItem({
        jobID: currentWorkItem.jobID,
        scrollID: currentWorkItem.scrollID,
        serviceID: currentWorkItem.serviceID,
        status: WorkItemStatus.READY,
        stacCatalogLocation: currentWorkItem.stacCatalogLocation,
        workflowStepIndex: currentWorkItem.workflowStepIndex,
        sortIndex: currentWorkItem.sortIndex + 1,
      });

      await incrementReadyCount(tx, currentWorkItem.jobID, currentWorkItem.serviceID);
      await nextQueryCmrItem.save(tx);

      // ask the scheduler to schedule the new work item
      await makeWorkScheduleRequest(currentWorkItem.serviceID);

      logger.info('Queued new query-cmr work item.');
    }
  }
}

/**
 * Creates the next work items for the workflow based on the results of the current step and handle
 * any needed batching
 * @param tx - The database transaction
 * @param currentWorkflowStep - the current step in the workflow chain
 * @param nextWorkflowStep - the next workflow step in the chain after the current workflow step
 * @param logger - a Logger instance
 * @param workItem - The current work item
 * @param allWorkItemsForStepComplete - true if all the work items for the current step are complete
 * @param results - an array of paths to STAC catalogs
 * @param outputItemSizes - an array of sizes (in bytes) of the output items for the current step
 *
 * @returns true if it created a work item
 */
export async function createNextWorkItems(
  tx: Transaction,
  currentWorkflowStep: WorkflowStep,
  nextWorkflowStep: WorkflowStep,
  logger: Logger,
  workItem: WorkItem,
  allWorkItemsForStepComplete: boolean,
  results: string[],
  outputItemSizes: number[],
): Promise<boolean> {
  let didCreateWorkItem = false;
  // When a work-item update comes in we have three possible cases to handle:
  // 1. next step aggregates AND uses batching - in this case we process each result and put it
  //  into a batch. As batches fill up we generate a new work-item for the next step and create
  //  a new batch if needed. We have a check to see if we have completed all the work-items for
  //  the current step, in which case we close the last batch even if it is not full and
  //  generate a final work-item for the next step
  // 2. next step aggregates, but does not use batching, so we only create a new work-item
  //  for the next step if we have completed all the work-items for the current step
  // 3. next step does not aggregate, so we create a new work-item for the next step for each
  //  result from this work-item update
  if (nextWorkflowStep.hasAggregatedOutput) {
    if (nextWorkflowStep.isBatched) {
      let sortIndex;
      if (!QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
        // eslint-disable-next-line prefer-destructuring
        sortIndex = workItem.sortIndex;
      }
      let outputItemUrls = [];
      if (workItem.status !== WorkItemStatus.FAILED) {
        outputItemUrls = await outputStacItemUrls(results);
      }
      didCreateWorkItem = await handleBatching(
        tx,
        logger,
        nextWorkflowStep,
        outputItemUrls,
        outputItemSizes,
        sortIndex,
        workItem.status,
        allWorkItemsForStepComplete);
    } else if (allWorkItemsForStepComplete) {
      didCreateWorkItem = await createAggregatingWorkItem(tx, workItem, nextWorkflowStep, logger);
      if (didCreateWorkItem) {
        nextWorkflowStep.workItemCount += 1;
      }
    }

  } else {
    // Create a new work item for each result using the next step
    didCreateWorkItem = true;

    // use the sort index from the previous step's work item unless the service was
    // query-cmr, in which case we start from the previous highest sort index for this step
    // NOTE: This is only valid if the work-items for this multi-output step are worked
    // sequentially and have consistently ordered outputs, as with query-cmr.
    // If they are worked in parallel then we need a different approach.
    let { sortIndex } = workItem;
    let shouldIncrementSortIndex = false;
    if (currentWorkflowStep.hasAggregatedOutput || currentWorkflowStep.is_sequential) {
      shouldIncrementSortIndex = true;

      if (currentWorkflowStep.is_sequential) {
        sortIndex = await maxSortIndexForJobService(tx, nextWorkflowStep.jobID, nextWorkflowStep.serviceID) + 1;
      }
    }
    const newItems = results.map(result => {
      const newItem = new WorkItem({
        jobID: workItem.jobID,
        serviceID: nextWorkflowStep.serviceID,
        status: WorkItemStatus.READY,
        stacCatalogLocation: result,
        workflowStepIndex: nextWorkflowStep.stepIndex,
        sortIndex,
      });

      if (shouldIncrementSortIndex) {
        sortIndex += 1;
      }

      return newItem;
    });

    nextWorkflowStep.workItemCount += newItems.length;
    await incrementReadyCount(tx, workItem.jobID, nextWorkflowStep.serviceID, newItems.length);
    for (const batch of _.chunk(newItems, batchSize)) {
      await WorkItem.insertBatch(tx, batch);
      logger.info('Created new set of work items.');
    }
  }
  if (didCreateWorkItem) {
    await nextWorkflowStep.save(tx);
  }
  return didCreateWorkItem;
}

/**
 * Preprocess a work item and return the catalog items and result item size
 * inside the return type WorkItemPreprocessInfo.
 *
 * @param update - information about the work item update
 * @param operation - the DataOperation for the user's request
 * @param logger - the Logger for the request
 *
 * @returns work item preprocess result
 */
export async function preprocessWorkItem(
  update: WorkItemUpdate,
  operation: object,
  logger: Logger,
  nextWorkflowStep: WorkflowStep,
): Promise<WorkItemPreprocessInfo> {
  const startTime = new Date().getTime();
  const { results } = update;
  let { message, status } = update;

  // Get the sizes of all the data items/granules returned for the WorkItem and STAC item links
  // when batching. This needs to be done outside the main db transaction since it involves reading
  // the catalogs from S3.
  let durationMs;
  let outputItemSizes;
  let catalogItems;
  try {
    if (status == WorkItemStatus.SUCCESSFUL && !nextWorkflowStep) {
      // if we are CREATING STAC CATALOGS for the last step in the chain we should read the catalog items
      // since they are needed for generating the output links we will save
      catalogItems = await readCatalogsItems(results);
      durationMs = new Date().getTime() - startTime;
      logger.info('timing.HWIUWJI.readCatalogItems.end', { durationMs });
    }
    const resultStartTime = new Date().getTime();
    outputItemSizes = await resultItemSizes(update, operation, logger);
    durationMs = new Date().getTime() - resultStartTime;
    logger.info('timing.HWIUWJI.getResultItemSize.end', { durationMs });
  } catch (e) {
    if (catalogItems) {
      message = 'Cannot get result item file size from output STAC';
    } else {
      message = 'Cannot parse STAC catalog output from service';
    }

    logger.error(message);
    logger.error(`Caught exception: ${e.message}`, { name: e.name, stack: e.stack });
    status = WorkItemStatus.FAILED;
  }
  const result: WorkItemPreprocessInfo = {
    status,
    catalogItems,
    outputItemSizes,
  };
  return result;
}

/**
 * Process the work item update using the preprocessed result info and the work item info.
 * Various other parameters are passed in to optimize the processing of a batch of work items.
 * A database lock on the work item related job needs to be acquired before calling this function.
 * WARN To avoid dB deadlocks, this function should be not be called from a Promise.all.
 *
 * @param tx - database transaction with lock on the related job in the jobs table
 * @param preprocessedResult - information obtained in earlier processing for efficiency reasons
 * @param job - job of the work item
 * @param update - information about the work item update
 * @param logger - the Logger for the request
 * @param checkCompletion - true if needs to check if the whole job has completed
 * @param thisStep - the current workflow step the work item is being processed in
 */
export async function processWorkItem(
  tx: Transaction,
  preprocessResult: WorkItemPreprocessInfo,
  job: Job,
  update: WorkItemUpdate,
  logger: Logger,
  checkCompletion,
  thisStep: WorkflowStep,
): Promise<void> {
  const { jobID } = job;
  let { status } = preprocessResult;
  const { catalogItems, outputItemSizes } = preprocessResult;
  let { message } = update;
  const { workItemID, hits, results, scrollID, message_category } = update;
  const startTime = new Date().getTime();
  let durationMs;
  let jobSaveStartTime;
  let didCreateWorkItem = false;
  let serviceId;

  logger.info(`Received update for work item ${workItemID} to ${status}`);

  try {
    // lock the work item so we can update it - need to do this after locking jobs table above
    // to avoid deadlocks
    const workItem = await (await logAsyncExecutionTime(
      getWorkItemById,
      'HWIUWJI.getWorkItemById',
      logger))(tx, workItemID, true);
    if (!thisStep) {
      thisStep = await (await logAsyncExecutionTime(
        getWorkflowStepByJobIdStepIndex,
        'HWIUWJI.getWorkflowStepByJobIdStepIndex',
        logger))(tx, workItem.jobID, workItem.workflowStepIndex);
    }
    serviceId = workItem.serviceID;
    if (job.hasTerminalStatus() && status !== WorkItemStatus.CANCELED) {
      logger.warn(`Job was already ${job.status}.`);
      const numRowsDeleted = await (await logAsyncExecutionTime(
        deleteUserWorkForJob,
        'HWIUWJI.deleteUserWorkForJob',
        logger))(tx, jobID);
      logger.warn(`Removed ${numRowsDeleted} from user_work table for job ${jobID}.`);
      // Note work item will stay in the running state, but the reaper will clean it up
      return;
    }

    // Don't allow updates to work items that are already in a terminal state
    if (COMPLETED_WORK_ITEM_STATUSES.includes(workItem.status)) {
      // Unclear what to do with user_work entries, so do nothing for now.
      logger.warn(`WorkItem ${workItemID} was already ${workItem.status}`);
      return;
    }

    const hasOutput = results && results.length > 0;
    if (status === WorkItemStatus.SUCCESSFUL && !hasOutput) {
      // To return no output the status needs to be a warning, otherwise we treat it as an error
      logger.error('The work item update should have contained results, but it did not.');
      message = 'Service did not return any outputs.';
      status = WorkItemStatus.FAILED;
    }

    // retry failed work-items up to a limit
    if (status === WorkItemStatus.FAILED) {
      if (workItem.retryCount < env.workItemRetryLimit) {
        logger.info(`Retrying failed work-item ${workItemID}`);
        workItem.retryCount += 1;
        workItem.status = WorkItemStatus.READY;
        const workitemSaveStartTime = new Date().getTime();
        await workItem.save(tx);
        durationMs = new Date().getTime() - workitemSaveStartTime;
        logger.info('timing.HWIUWJI.workItem.save.end', { durationMs });
        await (await logAsyncExecutionTime(
          incrementReadyAndDecrementRunningCounts,
          'HWIUWJI.incrementReadyAndDecrementRunningCounts',
          logger))(tx, jobID, workItem.serviceID);
        return;
      } else {
        logger.warn(`Retry limit of ${env.workItemRetryLimit} exceeded`);
        logger.warn(
          `Updating work item for ${workItemID} to ${status} with message ${message}`,
          { workFailureMessage: message, serviceId: workItem.serviceID, status },
        );
      }
    }

    // We calculate the duration of the work both in harmony and in the manager of the service pod.
    // We tend to favor the harmony value as it is normally longer since it accounts for the extra
    // overhead of communication with the pod. There is a problem with retries however in that
    // the startTime gets reset, so if an earlier worker finishes and replies it will look like
    // the whole thing was quicker (since our startTime has changed). So in that case we want to
    // use the time reported by the service pod. Any updates from retries that happen later  will
    // be ignored since the work item is already in a 'successful' state.
    const harmonyDuration = Date.now() - workItem.startedAt.valueOf();
    let duration = harmonyDuration;
    if (update.duration) {
      duration = Math.max(duration, update.duration);
    }

    let { totalItemsSize } = update;

    if (!totalItemsSize && outputItemSizes?.length > 0) {
      totalItemsSize = sum(outputItemSizes) / 1024 / 1024;
    }

    if (COMPLETED_WORK_ITEM_STATUSES.includes(status)) {
      thisStep.completed_work_item_count += 1;
      await thisStep.save(tx);
    }

    await (await logAsyncExecutionTime(
      updateWorkItemStatus,
      'HWIUWJI.updateWorkItemStatus',
      logger))(
      tx,
      workItemID,
      status,
      message_category,
      duration,
      totalItemsSize,
      outputItemSizes);
    await (await logAsyncExecutionTime(
      decrementRunningCount,
      'HWIUWJI.decrementRunningCount',
      logger))(tx, jobID, workItem.serviceID);

    logger.info(`Updated work item. Duration (ms) was: ${duration}`);

    workItem.status = status;
    workItem.message_category = message_category;

    let allWorkItemsForStepComplete = false;

    // The number of 'hits' returned by a query-cmr could be less than when CMR was first
    // queried by harmony due to metadata deletions from CMR, so we update the job to reflect
    // that there are fewer items and to know when no more query-cmr jobs should be created.
    if (hits && job.numInputGranules > hits) {
      job.numInputGranules = hits;

      jobSaveStartTime = new Date().getTime();
      await job.save(tx);
      durationMs = new Date().getTime() - jobSaveStartTime;
      logger.info('timing.HWIUWJI.job.save.end', { durationMs });

      await (await logAsyncExecutionTime(
        updateCmrWorkItemCount,
        'HWIUWJI.updateCmrWorkItemCount',
        logger))(tx, job);
    }

    await job.updateProgress(tx);
    await job.save(tx);

    if (checkCompletion) {
      allWorkItemsForStepComplete = await updateIsComplete(tx, jobID, job.numInputGranules, thisStep);
      if (allWorkItemsForStepComplete) {
        await deleteUserWorkForJobAndService(tx, jobID, serviceId);
      }
    }

    const continueProcessing = await (await logAsyncExecutionTime(
      handleFailedWorkItems, 'HWIUWJI.handleFailedWorkItems', logger)
    )(tx, job, workItem, status, logger, message);
    if (continueProcessing) {
      const nextWorkflowStep = await (await logAsyncExecutionTime(
        getWorkflowStepByJobIdStepIndex,
        'HWIUWJI.getWorkflowStepByJobIdStepIndex',
        logger))(tx, workItem.jobID, workItem.workflowStepIndex + 1);

      if (nextWorkflowStep && (![WorkItemStatus.FAILED, WorkItemStatus.WARNING].includes(status)
        || nextWorkflowStep?.hasAggregatedOutput)) {
        didCreateWorkItem = await (await logAsyncExecutionTime(
          createNextWorkItems,
          'HWIUWJI.createNextWorkItems',
          logger))(
          tx,
          thisStep,
          nextWorkflowStep,
          logger,
          workItem,
          allWorkItemsForStepComplete,
          results,
          outputItemSizes,
        );
        if (didCreateWorkItem) {
          // ask the scheduler to schedule the new work item
          await (await logAsyncExecutionTime(
            makeWorkScheduleRequest,
            'HWIUWJI.makeWorkScheduleRequest',
            logger))(nextWorkflowStep.serviceID);
        }
      }
      if (status === WorkItemStatus.SUCCESSFUL) {
        if (hasOutput) {
          // set the scrollID for the next work item to the one we received from the update
          workItem.scrollID = scrollID;
          await (await logAsyncExecutionTime(
            maybeQueueQueryCmrWorkItem,
            'HWIUWJI.maybeQueueQueryCmrWorkItem',
            logger))(tx, workItem, logger);
        } else {
          // Failed to create the next work items when there should be work items.
          // Fail the job rather than leaving it orphaned in the running state
          logger.error('Should never reach this case. If we reach this case it is possible that we are missing output');
          throw new ServerError('Service did not return any outputs');
        }
      }

      if (!nextWorkflowStep) {
        // Finished with the chain for this granule
        if (status == WorkItemStatus.SUCCESSFUL) {
          await (await logAsyncExecutionTime(
            addJobLinksForFinishedWorkItem,
            'HWIUWJI.addJobLinksForFinishedWorkItem',
            logger))(tx, job.jobID, catalogItems);
        }
      }

      if (allWorkItemsForStepComplete) {
        if (!didCreateWorkItem && (!nextWorkflowStep || nextWorkflowStep.workItemCount < 1)) {
          // If all granules are finished mark the job as finished
          const { finalStatus, finalMessage } = await getFinalStatusAndMessageForJob(tx, job);
          await (await logAsyncExecutionTime(
            completeJob,
            'HWIUWJI.completeJob',
            logger))(tx, job, finalStatus, logger, finalMessage);
        }
      } else { // Currently only reach this condition for batched aggregation requests

        if (!nextWorkflowStep && job.status === JobStatus.PREVIEWING) {
          // Special case to pause the job as soon as any single granule completes when in the previewing state
          jobSaveStartTime = new Date().getTime();
          await job.pauseAndSave(tx);
          durationMs = new Date().getTime() - jobSaveStartTime;
          logger.info('timing.HWIUWJI.job.pauseAndSave.end', { durationMs });
        } else {
          jobSaveStartTime = new Date().getTime();
          await job.save(tx);
          durationMs = new Date().getTime() - jobSaveStartTime;
          logger.info('timing.HWIUWJI.job.save.end', { durationMs });
        }

      }

      jobSaveStartTime = new Date().getTime();
      await job.save(tx);
      durationMs = new Date().getTime() - jobSaveStartTime;
      logger.info('timing.HWIUWJI.job.save.end', { durationMs });

    }
  } catch (e) {
    logger.error(`Work item update failed for work item ${workItemID} and status ${status}`);
    logger.error(e);
  }

  durationMs = new Date().getTime() - startTime;
  logger.info('timing.HWIUWJI.end', { durationMs });
  logger.info(
    `Finished handling work item update for work item id ${workItemID} for service ${serviceId} and status ${status} in ${durationMs} ms`,
    { workItemId: workItemID, status, durationMs, serviceId },
  );
}


/**
 * Process a list of work item updates for a given job
 *
 * @param jobId - job id
 * @param workflowStepIndex - the current workflow step of the work items
 * @param items - a list of work item update items
 * @param logger - the Logger for the request
 */
export async function processWorkItems(
  jobID: string,
  workflowStepIndex: number,
  items: WorkItemUpdateQueueItem[],
  logger: Logger,
): Promise<void> {
  try {
    const transactionStart = new Date().getTime();

    await db.transaction(async (tx) => {
      const { job } = await (await logAsyncExecutionTime(
        Job.byJobID,
        'HWIUWJI.Job.byJobID',
        logger))(tx, jobID, false, false, true);

      if (job.hasTerminalStatus()) {
        logger.warn(`Ignoring work item updates for job ${jobID} in terminal state ${job.status}.`);
      } else {
        const thisStep: WorkflowStep = await (await logAsyncExecutionTime(
          getWorkflowStepByJobIdStepIndex,
          'HWIUWJI.getWorkflowStepByJobIdStepIndex',
          logger))(tx, jobID, workflowStepIndex);

        const lastIndex = items.length - 1;
        for (let index = 0; index < items.length; index++) {
          const { preprocessResult, update } = items[index];
          if (index < lastIndex) {
            await processWorkItem(tx, preprocessResult, job, update, logger, false, thisStep);
          } else {
            await processWorkItem(tx, preprocessResult, job, update, logger, true, thisStep);
          }
        }
      }
      if (job.status === JobStatus.PAUSED) {
        await setReadyCountToZero(tx, jobID);
      }
    });
    const durationMs = new Date().getTime() - transactionStart;
    logger.info('timing.HWIUWJI.transaction.end', { durationMs });
  } catch (e) {
    logger.error('Unable to acquire lock on Jobs table');
    logger.error(e);
  }
}

/**
 * Process a granule validation work item update
 *
 * @param jobId - job id
 * @param update - the work item update
 * @param logger - the Logger for the request
 */
async function handleGranuleValidation(
  jobID: string,
  update: WorkItemUpdate,
  logger: Logger): Promise<void> {
  const { workItemID, status, message } = update;
  try {
    const transactionStart = new Date().getTime();

    await db.transaction(async (tx) => {
      const { job } = await (await logAsyncExecutionTime(
        Job.byJobID,
        'HWIUWJI.Job.byJobID',
        logger))(tx, jobID, false, false, true);

      if (status === WorkItemStatus.FAILED) {
        // update job status and message
        await completeJob(tx, job, JobStatus.FAILED, logger, message);
      } else {
        // update workflowstep operation
        const thisWorkflowStep = await (await logAsyncExecutionTime(
          getWorkflowStepByJobIdStepIndex,
          'HWIUWJI.getWorkflowStepByJobIdStepIndex',
          logger))(db, jobID, update.workflowStepIndex);
        const op = JSON.parse(thisWorkflowStep.operation);
        op.extraArgs.granValidation = undefined;
        thisWorkflowStep.operation = JSON.stringify(op);
        await thisWorkflowStep.save(tx);

        let needSave = false;
        if (update.hits && job.numInputGranules > update.hits) {
          job.numInputGranules = update.hits;
          needSave = true;
        }

        if (message) {
          // update job message for running and successful status
          job.message = message;
          job.setMessage(message, JobStatus.SUCCESSFUL);
          needSave = true;
        }

        if (needSave) {
          await job.save(tx);
        }

        // mark the work item as ready to be processed without granule validation
        const workItem = await (await logAsyncExecutionTime(
          getWorkItemById,
          'HWIUWJI.getWorkItemById',
          logger))(tx, workItemID, true);

        logger.info(`Granule validation is successful, continue processing work-item ${workItemID}`);
        workItem.status = WorkItemStatus.READY;
        await workItem.save(tx);

        await (await logAsyncExecutionTime(
          incrementReadyAndDecrementRunningCounts,
          'HWIUWJI.incrementReadyAndDecrementRunningCounts',
          logger))(tx, jobID, workItem.serviceID);
      }
    });
    const durationMs = new Date().getTime() - transactionStart;
    logger.info('timing.HWIUWJI.handleGranValidation.end', { durationMs });
  } catch (e) {
    logger.error('Unable to acquire lock on Jobs table');
    logger.error(e);
  }
}

/**
 * Updates the batch of work items.
 * It is assumed that all the work items belong to the same job.
 * It processes the work item updates in groups by the workflow step.
 * @param jobID - ID of the job that the work item updates belong to
 * @param updates - List of work item updates
 * @param originalLogger - Logger to use
 */
export async function handleBatchWorkItemUpdatesWithJobId(
  jobID: string,
  updates: WorkItemUpdateQueueItem[],
  originalLogger: Logger,
): Promise<void> {
  const startTime = new Date().getTime();
  const logger = originalLogger.child({ jobId: jobID });
  logger.debug(`Processing ${updates.length} work item updates for job ${jobID}`);
  // group updates by workflow step index to make sure at least one completion check is performed for each step
  const groups = _.groupBy(updates, (update) => update.update.workflowStepIndex);
  for (const workflowStepIndex of Object.keys(groups)) {
    if (groups[workflowStepIndex][0].update.message_category === 'granValidation') {
      await handleGranuleValidation(jobID, groups[workflowStepIndex][0].update, logger);
    } else {
      const nextWorkflowStep = await (await logAsyncExecutionTime(
        getWorkflowStepByJobIdStepIndex,
        'HWIUWJI.getWorkflowStepByJobIdStepIndex',
        logger))(db, jobID, parseInt(workflowStepIndex) + 1);

      const preprocessedWorkItems: WorkItemUpdateQueueItem[] = await Promise.all(
        groups[workflowStepIndex].map(async (item: WorkItemUpdateQueueItem) => {
          const { update, operation } = item;
          const result = await preprocessWorkItem(update, operation, logger, nextWorkflowStep);
          item.preprocessResult = result;
          return item;
        }));
      await processWorkItems(jobID, parseInt(workflowStepIndex), preprocessedWorkItems, logger);
    }
  }
  const durationMs = new Date().getTime() - startTime;
  logger.info('timing.HWIUWJI.batch.end', { durationMs });
}