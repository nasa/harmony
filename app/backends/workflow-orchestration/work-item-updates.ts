import defaultLogger from '../../util/log';
import env from '../../util/env';
import { v4 as uuid } from 'uuid';
import { WorkItemUpdateQueueType } from '../../util/queue/queue';
import { getQueueForType } from '../../util/queue/queue-factory';
import WorkItemUpdate from '../../models/work-item-update';
import WorkflowStep, { decrementFutureWorkItemCount, getWorkflowStepByJobIdStepIndex, getWorkflowStepsByJobId } from '../../models/workflow-steps';
import { Logger } from 'winston';
import _, { ceil, range, sum } from 'lodash';
import { JobStatus, Job } from '../../models/job';
import JobError, { getErrorCountForJob } from '../../models/job-error';
import JobLink, { getJobDataLinkCount } from '../../models/job-link';
import { incrementReadyCount, deleteUserWorkForJob, incrementReadyAndDecrementRunningCounts, decrementRunningCount } from '../../models/user-work';
import WorkItem, { maxSortIndexForJobService, workItemCountForStep, getWorkItemsByJobIdAndStepIndex, getWorkItemById, updateWorkItemStatus, getJobIdForWorkItem } from '../../models/work-item';
import { WorkItemStatus, WorkItemMeta, COMPLETED_WORK_ITEM_STATUSES } from '../../models/work-item-interface';
import { outputStacItemUrls, handleBatching, resultItemSizes } from '../../util/aggregation-batch';
import db, { Transaction, batchSize } from '../../util/db';
import { ServiceError } from '../../util/errors';
import { completeJob } from '../../util/job';
import { objectStoreForProtocol } from '../../util/object-store';
import { StacItem, readCatalogItems, StacItemLink, StacCatalog } from '../../util/stac';
import { sanitizeImage } from '../../util/string';
import { resolve } from '../../util/url';
import { QUERY_CMR_SERVICE_REGEX, calculateQueryCmrLimit } from './util';


type WorkItemUpdateQueueItem = {
  update: WorkItemUpdate,
  operation: object,
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
  tx: Transaction, job: Job, workItem: WorkItem, workflowStep: WorkflowStep, status: WorkItemStatus,
  logger: Logger, errorMessage: string,
): Promise<boolean> {
  let continueProcessing = true;
  // If the response is an error then set the job status to 'failed'
  if (status === WorkItemStatus.FAILED) {
    continueProcessing = job.ignoreErrors;
    if (!job.isComplete()) {
      let jobMessage;

      if (errorMessage) {
        jobMessage = `WorkItem [${workItem.id}] failed with error: ${errorMessage}`;
      }

      if (QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) {
        // Fail the request if query-cmr fails to populate granules
        continueProcessing = false;
        if (!jobMessage) {
          jobMessage = `WorkItem [${workItem.id}] failed to query CMR for granule information`;
        }
      } else {
        const url = await getWorkItemUrl(workItem, logger);
        if (!jobMessage) {
          jobMessage = `WorkItem [${workItem.id}] failed with an unknown error`;
        }
        await addErrorForWorkItem(tx, job, url, jobMessage);
      }

      if (continueProcessing) {
        const errorCount =  await getErrorCountForJob(tx, job.jobID);
        if (errorCount > env.maxErrorsForJob) {
          jobMessage = `Maximum allowed errors ${env.maxErrorsForJob} exceeded`;
          logger.warn(jobMessage);
          continueProcessing = false;
        }
      }

      if (!continueProcessing) {
        await completeJob(tx, job, JobStatus.FAILED, logger, jobMessage);
      } else {
        // Need to make sure we expect one fewer granule to complete
        await decrementFutureWorkItemCount(tx, job.jobID, workflowStep.stepIndex);
        if (job.status == JobStatus.RUNNING) {
          job.status = JobStatus.RUNNING_WITH_ERRORS;
          await job.save(tx);
        }
      }
    }
  }
  return continueProcessing;
}

/**
 * Updated the workflow steps `workItemCount` field for the given job to match the new
 *
 * @param transaction - the transaction to use for the update
 * @param job - A Job that has a new input granule count
 */
async function updateWorkItemCounts(
  transaction: Transaction,
  job: Job):
  Promise<void> {
  const workflowSteps = await getWorkflowStepsByJobId(transaction, job.jobID);
  for (const step of workflowSteps) {
    if (QUERY_CMR_SERVICE_REGEX.test(step.serviceID)) {
      step.workItemCount = Math.ceil(job.numInputGranules / env.cmrMaxPageSize);
    } else if (!step.hasAggregatedOutput) {
      step.workItemCount = job.numInputGranules;
    } else {
      step.workItemCount = 1;
    }
    await step.save(transaction);
  }
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
 */
async function createAggregatingWorkItem(
  tx: Transaction, currentWorkItem: WorkItem, nextStep: WorkflowStep, logger: Logger,
): Promise<void> {
  const itemLinks: StacItemLink[] = [];
  const s3 = objectStoreForProtocol('s3');
  // get all the previous results
  const workItemCount = await workItemCountForStep(tx, currentWorkItem.jobID, nextStep.stepIndex - 1);
  let page = 1;
  let processedItemCount = 0;
  while (processedItemCount < workItemCount) {
    const prevStepWorkItems = await getWorkItemsByJobIdAndStepIndex(tx, currentWorkItem.jobID, nextStep.stepIndex - 1, page);
    // guard against failure case where we cannot retrieve all items - THIS SHOULD NEVER HAPPEN
    if (prevStepWorkItems.workItems.length < 1) break;

    for (const workItem of prevStepWorkItems.workItems) {
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
  const itemMeta: WorkItemMeta = { workItemService: sanitizeImage(newWorkItem.serviceID),
    workItemEvent: 'statusUpdate', workItemAmount: 1, workItemStatus: WorkItemStatus.READY };
  logger.info('Queued new aggregating work item.', itemMeta);
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
      const itemMeta: WorkItemMeta = { workItemService: sanitizeImage(nextQueryCmrItem.serviceID),
        workItemEvent: 'statusUpdate', workItemAmount: 1, workItemStatus: WorkItemStatus.READY };
      logger.info('Queued new query-cmr work item.', itemMeta);
    }
  }
}

/**
 * Creates the next work items for the workflow based on the results of the current step and handle
 * any needed batching
 * @param tx - The database transaction
 * @param nextWorkflowStep - the next workflow step in the chain after the current workItem
 * @param logger - a Logger instance
 * @param workItem - The current work item
 * @param allWorkItemsForStepComplete - true if all the work items for the current step are complete
 * @param results - an array of paths to STAC catalogs
 * @param outputItemSizes - an array of sizes (in bytes) of the output items for the current step
 *
 * @returns true if it created a work item
 */
async function createNextWorkItems(
  tx: Transaction,
  nextWorkflowStep: WorkflowStep,
  logger: Logger,
  workItem: WorkItem,
  allWorkItemsForStepComplete: boolean,
  results: string[],
  outputItemSizes: number[],
): Promise<boolean> {
  let didCreateWorkItem = false;
  if (results && results.length > 0 || nextWorkflowStep.isBatched) {
    didCreateWorkItem = true;
    // if we have completed all the work items for this step or if the next step does not
    // aggregate then create a work item for the next step
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
        // TODO add other services that can produce more than one output and so should have their
        // batching sortIndex propagated to child work items to provide consistent batching
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
        await createAggregatingWorkItem(tx, workItem, nextWorkflowStep, logger);
      }
    } else {
      // Create a new work item for each result using the next step

      // use the sort index from the previous step's work item unless we have more than one
      // result, in which case we start from the previous highest sort index for this step
      // NOTE: This is only valid if the work-items for this multi-output step are worked
      // sequentially, as with query-cmr. If they are worked in parallel then we need a
      // different approach.
      let { sortIndex } = workItem;
      if (results.length > 1) {
        sortIndex = await maxSortIndexForJobService(tx, nextWorkflowStep.jobID, nextWorkflowStep.serviceID);
      }
      const newItems = results.map(result => {
        sortIndex += 1;
        return new WorkItem({
          jobID: workItem.jobID,
          serviceID: nextWorkflowStep.serviceID,
          status: WorkItemStatus.READY,
          stacCatalogLocation: result,
          workflowStepIndex: nextWorkflowStep.stepIndex,
          sortIndex,
        });
      });

      await incrementReadyCount(tx, workItem.jobID, nextWorkflowStep.serviceID, newItems.length);
      for (const batch of _.chunk(newItems, batchSize)) {
        await WorkItem.insertBatch(tx, batch);
        const itemMeta: WorkItemMeta = { workItemService: sanitizeImage(nextWorkflowStep.serviceID),
          workItemEvent: 'statusUpdate', workItemAmount: batch.length, workItemStatus: WorkItemStatus.READY };
        logger.info('Queued new batch of work items.', itemMeta);
      }
    }
  }
  return didCreateWorkItem;
}

/**
 * Update job status/progress in response to a service provided work item update
 * IMPORTANT: This asynchronous function is called without awaiting, so any errors must be
 * handled in this function and no exceptions should be thrown since nothing will catch
 * them.
 *
 * @param jobId - job id
 * @param update - information about the work item update
 * @param operation - the DataOperation for the user's request
 * @param logger - the Logger for the request
 */
export async function handleWorkItemUpdateWithJobId(
  jobID: string,
  update: WorkItemUpdate,
  operation: object,
  logger: Logger): Promise<void> {
  const startTime = Date.now();
  const { workItemID, hits, results, scrollID } = update;
  let { errorMessage, status } = update;
  let didCreateWorkItem = false;
  if (status === WorkItemStatus.SUCCESSFUL) {
    logger.info(`Updating work item ${workItemID} to ${status}`);
  }

  // Get the sizes of all the data items/granules returned for the WorkItem and STAC item links
  // when batching.
  // This needs to be done outside the transaction as it can be slow if there are many granules.
  let outputItemSizes;
  let catalogItems;
  try {
    if (results?.length < 2 && status === WorkItemStatus.SUCCESSFUL) {
      catalogItems = await readCatalogItems(results[0]);
    }
    outputItemSizes = await resultItemSizes(update, operation, logger);
  } catch (e) {
    logger.error('Could not get result item file size, failing the work item update');
    logger.error(e);
    status = WorkItemStatus.FAILED;
    errorMessage = 'Could not get result item file size, failing the work item update';
  }

  try {
    await db.transaction(async (tx) => {
      const job = await Job.byJobID(tx, jobID, false, true);
      // lock the work item so we can update it - need to do this after locking jobs table above
      // to avoid deadlocks
      const workItem = await getWorkItemById(tx, workItemID, true);
      const thisStep = await getWorkflowStepByJobIdStepIndex(tx, workItem.jobID, workItem.workflowStepIndex);
      if (job.isComplete() && status !== WorkItemStatus.CANCELED) {
        logger.warn(`Job was already ${job.status}.`);
        const numRowsDeleted = await deleteUserWorkForJob(tx, jobID);
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

      // retry failed work-items up to a limit
      if (status === WorkItemStatus.FAILED) {
        if (workItem.retryCount < env.workItemRetryLimit) {
          const itemMeta: WorkItemMeta = { workItemService: sanitizeImage(workItem.serviceID),
            workItemEvent: 'retry', workItemAmount: 1 };
          logger.info(`Retrying failed work-item ${workItemID}`, itemMeta);
          workItem.retryCount += 1;
          workItem.status = WorkItemStatus.READY;
          await workItem.save(tx);
          await incrementReadyAndDecrementRunningCounts(tx, jobID, workItem.serviceID);
          return;
        } else {
          logger.warn(`Retry limit of ${env.workItemRetryLimit} exceeded`);
          logger.warn(`Updating work item for ${workItemID} to ${status} with message ${errorMessage}`);
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

      await updateWorkItemStatus(
        tx,
        workItemID,
        status,
        duration,
        totalItemsSize,
        outputItemSizes);
      await decrementRunningCount(tx, jobID, workItem.serviceID);

      const itemMeta: WorkItemMeta = { workItemService: sanitizeImage(workItem.serviceID),
        workItemDuration: (duration / 1000), workItemStatus: status, workItemEvent: 'statusUpdate', workItemAmount: 1 };
      logger.info(`Updated work item. Duration (ms) was: ${duration}`, itemMeta);

      workItem.status = status;

      const completedWorkItemCount = await workItemCountForStep(
        tx, workItem.jobID, workItem.workflowStepIndex, COMPLETED_WORK_ITEM_STATUSES,
      );
      const allWorkItemsForStepComplete = (completedWorkItemCount == thisStep.workItemCount);

      // The number of 'hits' returned by a query-cmr could be less than when CMR was first queried
      // queried by harmony due to metadata deletions from CMR, so we update the job to reflect
      // that there are fewer items and to know when no more query-cmr jobs should be created.
      if (hits && job.numInputGranules > hits) {
        job.numInputGranules = hits;
        await job.save(tx);
        await updateWorkItemCounts(tx, job);
      }

      const continueProcessing = await handleFailedWorkItems(tx, job, workItem, thisStep, status, logger, errorMessage);
      if (continueProcessing) {
        const nextWorkflowStep = await getWorkflowStepByJobIdStepIndex(
          tx, workItem.jobID, workItem.workflowStepIndex + 1,
        );
        if (nextWorkflowStep && (status !== WorkItemStatus.FAILED || nextWorkflowStep?.isBatched)) {
          didCreateWorkItem = await createNextWorkItems(
            tx,
            nextWorkflowStep,
            logger,
            workItem,
            allWorkItemsForStepComplete,
            results,
            outputItemSizes,
          );
        }
        if (nextWorkflowStep && status === WorkItemStatus.SUCCESSFUL) {
          if (results && results.length > 0) {
            // set the scrollID for the next work item to the one we received from the update
            workItem.scrollID = scrollID;
            await maybeQueueQueryCmrWorkItem(tx, workItem, logger);
          } else {
            // Failed to create the next work items when there should be work items.
            // Fail the job rather than leaving it orphaned in the running state
            logger.error('The work item update should have contained results to queue a next work item, but it did not.');
            const message = 'Harmony internal failure: could not create the next work items for the request.';
            await completeJob(tx, job, JobStatus.FAILED, logger, message);
          }
        } else if (!nextWorkflowStep || allWorkItemsForStepComplete) {
          // Finished with the chain for this granule
          if (status != WorkItemStatus.FAILED) {
            await addJobLinksForFinishedWorkItem(tx, job.jobID, catalogItems);
          }
          job.completeBatch(thisStep.workItemCount);
          if (allWorkItemsForStepComplete && !didCreateWorkItem && (!nextWorkflowStep || nextWorkflowStep.workItemCount === 0)) {
            // If all granules are finished mark the job as finished
            const finalStatus = await getFinalStatusForJob(tx, job);
            await completeJob(tx, job, finalStatus, logger);
          } else {
            // Either previewing or next step is a batched step and this item failed
            if (job.status === JobStatus.PREVIEWING) {
              // Special case to pause the job as soon as any single granule completes when in the previewing state
              await job.pauseAndSave(tx);
            } else {
              await job.save(tx);
            }
          }
        } else { // Currently only reach this condition for batched aggregation requests
          await job.save(tx);
        }
      }
    });
  } catch (e) {
    logger.error(`Work item update failed for work item ${workItemID} and status ${status}`);
    logger.error(e);
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  logger.debug(`Finished handling work item update for ${workItemID} and status ${status} in ${duration} ms`);
}

/**
 * Update job status/progress in response to a service provided work item update
 *
 * @param update - information about the work item update
 * @param operation - the DataOperation for the user's request
 * @param logger - the Logger for the request
 */
export async function handleWorkItemUpdate(
  update: WorkItemUpdate,
  operation: object,
  logger: Logger): Promise<void> {
  const { workItemID } = update;
  // get the jobID for the work item
  const jobID = await getJobIdForWorkItem(workItemID);
  await handleWorkItemUpdateWithJobId(jobID, update, operation, logger);
}

/**
 * Updates the batch of work items. It is assumed that all the work items belong
 * to the same job. Currently, this function processes the updates sequentially, but it
 * may be changed to process them all at once in the future.
 * @param jobID - ID of the job that the work items belong to
 * @param updates - List of work item updates
 * @param logger - Logger to use
 */
async function handleBatchWorkItemUpdatesWithJobId(jobID: string, updates: WorkItemUpdateQueueItem[], logger: Logger): Promise<void> {
  // process each job's updates
  logger.debug(`Processing ${updates.length} work item updates for job ${jobID}`);
  await Promise.all(updates.map(async (item) => {
    const { update, operation } = item;
    await handleWorkItemUpdateWithJobId(jobID, update, operation, logger);
  }));

}

/**
 * This function processes a batch of work item updates.
 * It first creates a map of jobIDs to updates, then it processes each job's updates.
 * It calls the function handleBatchWorkItemUpdatesWithJobId to handle the updates.
 * @param updates - List of work item updates read from the queue
 * @param logger - Logger to use
 */
export async function handleBatchWorkItemUpdates(
  updates: WorkItemUpdateQueueItem[],
  logger: Logger): Promise<void> {
  logger.debug(`Processing ${updates.length} work item updates`);
  // create a map of jobIDs to updates
  const jobUpdates: Record<string, WorkItemUpdateQueueItem[]> =
    await updates.reduce(async (acc, item) => {
      const { workItemID } = item.update;
      const jobID = await getJobIdForWorkItem(workItemID);
      logger.debug(`Processing work item update for job ${jobID}`);
      const accValue = await acc;
      if (accValue[jobID]) {
        accValue[jobID].push(item);
      } else {
        accValue[jobID] = [item];
      }
      return accValue;
    }, {});
  // process each job's updates
  for (const jobID in jobUpdates) {
    const startTime = Date.now();
    logger.debug(`Processing ${jobUpdates[jobID].length} work item updates for job ${jobID}`);
    await handleBatchWorkItemUpdatesWithJobId(jobID, jobUpdates[jobID], logger);
    const endTime = Date.now();
    logger.debug(`Processing ${jobUpdates[jobID].length} work item updates for job ${jobID} took ${endTime - startTime} ms`);
  }
}

/**
 * This function processes a batch of work item updates from the queue.
 * @param queueType - Type of the queue to read from
 */
export async function batchProcessQueue(queueType: WorkItemUpdateQueueType): Promise<void> {
  const queue = getQueueForType(queueType);
  const startTime = Date.now();
  // use a smaller batch size for the large item update queue otherwise use the SQS max batch size
  // of 10
  const largeItemQueueBatchSize = Math.min(env.largeWorkItemUpdateQueueMaxBatchSize, 10);
  const otherQueueBatchSize = 10; // the SQS max batch size
  const queueBatchSize = queueType === WorkItemUpdateQueueType.LARGE_ITEM_UPDATE
    ? largeItemQueueBatchSize : otherQueueBatchSize;
  const messages = await queue.getMessages(queueBatchSize);
  if (messages.length < 1) {
    return;
  }
  // defaultLogger.debug(`Processing ${messages.length} work item updates from queue`);

  if (queueType === WorkItemUpdateQueueType.LARGE_ITEM_UPDATE) {
    // process each message individually
    for (const msg of messages) {
      try {
        const updateItem: WorkItemUpdateQueueItem = JSON.parse(msg.body);
        const { update, operation } = updateItem;
        defaultLogger.debug(`Processing work item update from queue for work item ${update.workItemID} and status ${update.status}`);
        await handleWorkItemUpdate(update, operation, defaultLogger);
      } catch (e) {
        defaultLogger.error(`Error processing work item update from queue: ${e}`);
      }
      try {
        // delete the message from the queue even if there was an error updating the work-item
        // so that we don't keep processing the same message over and over
        await queue.deleteMessage(msg.receipt);
      } catch (e) {
        defaultLogger.error(`Error deleting work item update from queue: ${e}`);
      }
    }
  } else {
    // potentially process all the messages at once. this actually calls `handleBatchWorkItemUpdates`,
    // which processes each job's updates individually right now. this just leaves the possibility
    // open for that function to be updated to process all the updates at once in a more efficient
    // manner. It also allows us to delete all the messages from the queue at once, which is more
    // efficient than deleting them one at a time.
    const updates: WorkItemUpdateQueueItem[] = messages.map((msg) => JSON.parse(msg.body));
    try {
      await handleBatchWorkItemUpdates(updates, defaultLogger);
    } catch (e) {
      defaultLogger.error(`Error processing work item updates from queue: ${e}`);
    }
    // delete all the messages from the queue at once (slightly more efficient)
    try {
      await queue.deleteMessages(messages.map((msg) => msg.receipt));
    } catch (e) {
      defaultLogger.error(`Error deleting work item updates from queue: ${e}`);
    }
  }
  const endTime = Date.now();
  defaultLogger.debug(`Processed ${messages.length} work item updates from queue in ${endTime - startTime} ms`);
}
