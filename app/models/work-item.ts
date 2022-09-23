import { subMinutes } from 'date-fns';
import { ILengthAwarePagination } from 'knex-paginate';
import _ from 'lodash';
import { interquartileRange, max, quantile } from 'simple-statistics';
import logger from '../util/log';
import db, { Transaction } from '../util/db';
import DataOperation from './data-operation';
import { activeJobStatuses, Job, JobStatus } from './job';
import Record from './record';
import WorkflowStep, { getWorkflowStepByJobIdServiceId } from './workflow-steps';
import { WorkItemRecord, WorkItemStatus, getStacLocation, WorkItemQuery } from './work-item-interface';

// The step index for the query-cmr task. Right now query-cmr only runs as the first step -
// if this changes we will have to revisit this
const QUERY_CMR_STEP_INDEX = 1;

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'createdAt', 'retryCount', 'updatedAt', 'scrollID', 'serviceID', 'status',
  'stacCatalogLocation', 'totalGranulesSize', 'workflowStepIndex', 'duration', 'startedAt',
];

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkItem extends Record implements WorkItemRecord {
  static table = 'work_items';

  // The ID of the job that created this work item
  jobID: string;

  // The ID of the scroll session (only used for the query cmr service)
  scrollID?: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // The status of the operation - see WorkItemStatus
  status?: WorkItemStatus;

  // error message if status === FAILED
  errorMessage?: string;

  // The location of the STAC catalog for the item(s) to process
  stacCatalogLocation?: string;

  // The corresponding workflow step ID for the work item - used to look up the operation
  workflowStepIndex: number;

  // The string representation of the data operation to be performed by the service (not serialized)
  operation?: DataOperation;

  // The location of the resulting STAC catalog(s) (not serialized)
  results?: string[];

  // The sum of the sizes of the granules associated with this work item
  totalGranulesSize?: number;

  // The number of times this work-item has been retried
  retryCount: number;

  // When the work item started processing
  startedAt?: Date;

  // How long in milliseconds the work item took to process
  duration: number;

  /**
   * Saves the work item to the database using the given transaction.
   *
   * @param transaction - The transaction to use for saving the job link
   */
  async save(transaction: Transaction): Promise<void> {
    const record = _.pick(this, serializedFields);
    await super.save(transaction, record);
  }

  /**
   * Saves the work items to the database using a single SQL statement.
   *
   * @param transaction - The transaction to use for saving the job link
   * @param workItems - The work items to save
   */
  static async insertBatch(transaction: Transaction, workItems: WorkItem[]): Promise<void> {
    const fieldsList = workItems.map(item => _.pick(item, serializedFields));
    await super.insertBatch(transaction, workItems, fieldsList);
  }

  /**
   * Get the s3 URL to the STAC outputs directory for this work item.
   * Optionally pass in a target URL in which case the URL returned will be the target URL
   * resolved relative to the STAC outputs directory.
   * e.g. s3://artifacts/abc/123/outputs/ with a targetUrl of ./catalog0.json or catalog0.json would resolve to
   * s3://artifacts/abc/123/outputs/catalog0.json
   * @param targetUrl - URL to resolve against the base outptuts directory
   * @param isAggregate - include the word aggregate in the URL
   * @returns - the path to the STAC outputs directory (e.g. s3://artifacts/abc/123/outputs/) or the full path to the target URL
   */
  getStacLocation(targetUrl = '', isAggregate = false): string {
    return getStacLocation(this, targetUrl, isAggregate);
  }
}

// 'w' here is the alias for the 'work_items' table
const tableFields = serializedFields.map((field) => `w.${field}`);

/**
 * Returns the next work item to process for a service
 * @param tx - the transaction to use for querying
 * @param serviceID - the service ID looking for the next item to work
 *
 * @returns A promise with the work item to process or null if none
 */
export async function getNextWorkItem(
  tx: Transaction,
  serviceID: string,
): Promise<WorkItem> {
  let workItemData;
  const acceptableJobStatuses = _.cloneDeep(activeJobStatuses);
  // TODO: Now that we use search-after instead of scrolling we could allow pausing of query-cmr
  // work items and start them back up when the job is resumed because there is no session
  if (serviceID.includes('query-cmr')) {
    acceptableJobStatuses.push(JobStatus.PAUSED);
  }

  try {
    // Find users with work items queued for the service
    const subQueryForUsersRequestingService =
      tx(Job.table)
        .select('username')
        .join(`${WorkItem.table} as w`, `${Job.table}.jobID`, 'w.jobID')
        .whereIn(`${Job.table}.status`, acceptableJobStatuses)
        .where({ 'w.status': 'ready', serviceID });

    const userData = await tx(Job.table)
      .join(WorkItem.table, `${Job.table}.jobID`, '=', `${WorkItem.table}.jobID`)
      .select(['username'])
      .max(`${Job.table}.updatedAt`, { as: 'm' })
      .whereIn('username', subQueryForUsersRequestingService)
      .groupBy('username')
      .orderBy('m', 'asc')
      .first();

    if (userData?.username) {
      // query to choose the job that should be worked on next based on fair queueing policy
      const jobData = await tx(Job.table)
        .select([`${Job.table}.jobID`])
        .forUpdate()
        .join(`${WorkItem.table} as w`, `${Job.table}.jobID`, 'w.jobID')
        .where('username', '=', userData.username)
        .whereIn(`${Job.table}.status`, acceptableJobStatuses)
        .where({ 'w.status': 'ready', serviceID })
        .orderBy('isAsync', 'asc')
        .orderBy(`${Job.table}.updatedAt`, 'asc')
        .first();

      if (jobData?.jobID) {
        const workflowStepData = await tx(WorkflowStep.table)
          .select(['operation'])
          .where('jobID', '=', jobData.jobID)
          .first();
        if (workflowStepData?.operation) {
          const { operation } = workflowStepData;
          let workItemDataQuery = tx(`${WorkItem.table} as w`)
            .forUpdate()
            .select(tableFields)
            .where('w.jobID', '=', jobData.jobID)
            .where('w.status', '=', 'ready')
            .where('w.serviceID', '=', serviceID)
            .orderBy('w.id', 'asc')
            .first();

          if (db.client.config.client === 'pg') {
            workItemDataQuery = workItemDataQuery.skipLocked();
          }

          workItemData = await workItemDataQuery;

          if (workItemData) {
            workItemData.operation = JSON.parse(operation);
            const startedAt = new Date();
            await tx(WorkItem.table)
              .update({
                status: WorkItemStatus.RUNNING,
                updatedAt: startedAt,
                startedAt,
              })
              .where({ id: workItemData.id });
            // need to update the job otherwise long running jobs won't count against
            // the user's priority
            await tx(Job.table)
              .update({ updatedAt: new Date() })
              .where({ jobID: workItemData.jobID });
          }
        }
      }
    }
  } catch (e) {
    logger.error(`Error getting next work item for service [${serviceID}]`);
    logger.error(e);
    throw e;
  }

  return workItemData && new WorkItem(workItemData);
}

/**
 * Update the status and duration in the database for a WorkItem
 * @param tx - the transaction to use for querying
 * @param id - the id of the WorkItem
 * @param status - the status to set for the WorkItem
 * @param duration - how long the work item took to process
 * @param totalGranulesSize - the combined sizes of all the input granules for this work item
 */
export async function updateWorkItemStatus(
  tx: Transaction,
  id: number,
  status: WorkItemStatus,
  duration: number,
  totalGranulesSize: number,
): Promise<void> {
  logger.debug(`updatedWorkItemStatus: Updating status for work item ${id} to ${status}`);

  try {
    await tx(WorkItem.table)
      .update({ status, duration, totalGranulesSize, updatedAt: new Date() })
      .where({ id });
    logger.debug(`Status for work item ${id} set to ${status}`);
  } catch (e) {
    logger.error(`Failed to update work item ${id} status to ${status}`);
    logger.error(e);
    throw e;
  }
}

/**
 * Update the statuses in the database for the given WorkItem ids
 * @param tx - the transaction to use for querying
 * @param ids - the ids of the WorkItems
 * @param status - the status to set for the WorkItems
 */
export async function updateWorkItemStatuses(
  tx: Transaction,
  ids: number[],
  status: WorkItemStatus,
): Promise<void> {
  await tx(WorkItem.table)
    .update({ status, updatedAt: new Date() })
    .whereIn(`${WorkItem.table}.id`, ids);
}

/**
 * Update the status of work items by job ID.
 * @param tx - the transaction to use for the update
 * @param jobID - the jobID associated with the work items
 * @param oldStatuses - restricts the updates to work items where the status is in oldStatuses
 * @param newStatus - the value of the updated status
 */
export async function updateWorkItemStatusesByJobId(
  tx: Transaction,
  jobID: string,
  oldStatuses: WorkItemStatus[],
  newStatus: WorkItemStatus,
): Promise<void> {
  const updatedAt = new Date();
  await tx(WorkItem.table)
    .where({ jobID })
    .whereIn('status', oldStatuses)
    .update({ status: newStatus, updatedAt });
}

/**
 * Returns the next work item to process for a service
 * @param tx - the transaction to use for querying
 * @param id - the work item ID
 * @param lock - if true the work item is selected for update (locked)
 *
 * @returns A promise with the work item or null if none
 */
export async function getWorkItemById(
  tx: Transaction,
  id: number,
  lock = false,

): Promise<WorkItem> {
  let query = tx(WorkItem.table)
    .select()
    .where({ id })
    .first();
  if (lock) {
    query = query.forUpdate();
  }
  const workItemData = await query;

  const workItem = workItemData && new WorkItem(workItemData);
  return workItem;
}

/**
 * Returns an array of all work items that match the given constraints
 *
 * @param transaction - the transaction to use for querying
 * @param constraints - field / value pairs that must be matched for a record to be returned
 * @param currentPage - the index of the page to show
 * @param perPage - the number of results per page
 * @returns an object containing a list of work items and pagination data
 */
export async function queryAll(
  transaction: Transaction,
  constraints: WorkItemQuery = {},
  currentPage = 0,
  perPage = 10,
): Promise<{ workItems: WorkItem[]; pagination: ILengthAwarePagination }> {
  const items = await transaction(WorkItem.table)
    .select()
    .where(constraints.where)
    .orderBy(
      constraints?.orderBy?.field ?? 'createdAt', 
      constraints?.orderBy?.value ?? 'desc')
    .modify((queryBuilder) => {
      if (constraints.whereIn) {
        for (const field in constraints.whereIn) {
          const constraint = constraints.whereIn[field];
          if (constraint.in) {
            void queryBuilder.whereIn(field, constraint.values);
          } else {
            void queryBuilder.whereNotIn(field, constraint.values);
          }
        }
      }
    })
    .paginate({ currentPage, perPage, isLengthAware: true });

  const workItems = items.data.map((j) => new WorkItem(j));

  return {
    workItems,
    pagination: items.pagination,
  };
}

/**
 * Get the jobID for the given work item
 *
 * @param id - the work item id
 * @returns A map with the jobID and workflowStepIndex for the given work item
 */
export async function getJobIdForWorkItem(id: number): Promise<string> {
  return (
    await db(WorkItem.table)
      .select('jobID')
      .where({ id })
      .first()
  ).jobID;
}

/**
 * Returns all work items for a job
 * @param tx - the transaction to use for querying
 * @param jobID - the job ID
 * @param currentPage - the page of work items to get
 * @param perPage - number of results to include per page
 * @param sortOrder - orderBy string (desc or asc)
 *
 * @returns A promise with the work items array
 */
export async function getWorkItemsByJobId(
  tx: Transaction,
  jobID: string,
  currentPage = 0,
  perPage = 10,
  sortOrder: 'asc' | 'desc' = 'asc',
): Promise<{ workItems: WorkItem[]; pagination: ILengthAwarePagination }> {
  const query: WorkItemQuery = { 
    where: { jobID }, 
    orderBy : { field: 'id', value: sortOrder },
  };
  return queryAll(tx, query, currentPage, perPage);
}

/**
 * Returns work items for a job step
 * @param tx - the transaction to use for querying
 * @param jobID - the job ID
 * @param workflowStepIndex - the index of the workflow step
 * @param currentPage - the page of work items to get
 * @param perPage - number of results to include per page
 * @param sortOrder - orderBy string (desc or asc)
 *
 * @returns A promise with the work items array
 */
export async function getWorkItemsByJobIdAndStepIndex(
  tx: Transaction,
  jobID: string,
  workflowStepIndex: number,
  currentPage = 0,
  perPage = 100,
  sortOrder: 'asc' | 'desc' = 'asc',
): Promise<{ workItems: WorkItem[]; pagination: ILengthAwarePagination }> {
  const result = await tx(WorkItem.table)
    .select()
    .where({ jobID, workflowStepIndex })
    .orderBy('id', sortOrder)
    .paginate({ currentPage, perPage, isLengthAware: true });

  return {
    workItems: result.data.map((i) => new WorkItem(i)),
    pagination: result.pagination,
  };
}

/**
 * Get all work item ids associated with jobs that haven't been updated for a
 * certain amount of minutes and that have a particular JobStatus
 * @param tx - the transaction to use for querying
 * @param notUpdatedForMinutes - jobs with updateAt older than notUpdatedForMinutes ago
 * will be joined with the returned work items
 * @param jobStatus - only jobs with this status will be joined
 * @returns - all work item ids associated with the jobs that
 * met the updatedAt and status constraints
 */
export async function getWorkItemIdsByJobUpdateAgeAndStatus(
  tx: Transaction,
  notUpdatedForMinutes: number,
  jobStatus: JobStatus[],
): Promise<number[]> {
  const pastDate = subMinutes(new Date(), notUpdatedForMinutes);
  const workItemIds = (await tx(`${WorkItem.table} as w`)
    .innerJoin(Job.table, 'w.jobID', '=', `${Job.table}.jobID`)
    .select(...tableFields)
    .where(`${Job.table}.updatedAt`, '<', pastDate)
    .whereIn(`${Job.table}.status`, jobStatus))
    .map((item) => item.id);

  return workItemIds;
}

/**
 * Get all WorkItems (from running jobs)
 * that haven't been updated for a particular amount of time (minutes),
 * that also have a particular status.
 * @param tx - the transaction to use for querying
 * @param lastUpdateOlderThanMinutes - retrieve WorkItems with updatedAt older than lastUpdateOlderThanMinutes
 * @param workItemStatuses - only WorkItems with these statuses will be retrieved
 * @param jobStatuses - only WorkItems associated with jobs with these statuses will be retrieved
 * @param fields - optional parameter to indicate which fields to retrieve - defaults to all
 * @returns all WorkItems that meet the lastUpdateOlderThanMinutes and status constraints
*/
export async function getWorkItemsByUpdateAgeAndStatus(
  tx: Transaction,
  lastUpdateOlderThanMinutes: number,
  workItemStatuses: WorkItemStatus[],
  jobStatuses: JobStatus[],
  fields = tableFields,
): Promise<WorkItem[]> {
  const pastDate = subMinutes(new Date(), lastUpdateOlderThanMinutes);
  const workItems = (await tx(`${WorkItem.table} as w`)
    .innerJoin(Job.table, 'w.jobID', '=', `${Job.table}.jobID`)
    .select(...fields)
    .whereIn(`${Job.table}.status`, jobStatuses)
    .where('w.updatedAt', '<', pastDate)
    .whereIn('w.status', workItemStatuses))
    .map((item) => new WorkItem(item));

  return workItems;
}

/**
 * Delete all work items that have an id in the ids array.
 * @param tx - the transaction to use for querying
 * @param ids - the ids associated with work items that will be deleted
 * @returns - the number of deleted work items
 */
export async function deleteWorkItemsById(
  tx: Transaction,
  ids: number[],
): Promise<number> {
  const numDeleted = await tx(WorkItem.table)
    .whereIn('id', ids)
    .del();
  return numDeleted;
}

/**
 *  Returns the number of existing work items for a specific workflow step
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job that created this work item
 * @param stepIndex - the index of the step in the workflow
 * @param status - a single status or list of statuses. If provided only work items with this status
 * (or status in the list) will be counted
 */
export async function workItemCountForStep(
  tx: Transaction,
  jobID: string,
  stepIndex: number,
  status?: WorkItemStatus | WorkItemStatus[],
): Promise<number> {
  // Record<string, unknown> clashes with imported database Record class
  // so we use '{}' causing a linter error
  // eslint-disable-next-line @typescript-eslint/ban-types
  const whereClause: {} = {
    jobID, workflowStepIndex: stepIndex,
  };
  const statusArray = Array.isArray(status) ? status : [status];
  let count;

  if (status) {
    count = await tx(WorkItem.table)
      .select()
      .count('id')
      .where(whereClause)
      .whereIn('status', statusArray);
  } else {
    count = await tx(WorkItem.table)
      .select()
      .count('id')
      .where(whereClause);
  }

  let workItemCount;
  if (db.client.config.client === 'pg') {
    workItemCount = Number(count[0].count);
  } else {
    workItemCount = Number(count[0]['count(`id`)']);
  }
  return workItemCount;
}

/**
 *  Returns the number of existing work items for a specific job id
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job that created this work item
 */
export async function workItemCountForJobID(
  tx: Transaction,
  jobID: string,
): Promise<number> {
  const count = await tx(WorkItem.table)
    .select()
    .count('id')
    .where({ jobID });

  let workItemCount;
  if (db.client.config.client === 'pg') {
    workItemCount = Number(count[0].count);
  } else {
    workItemCount = Number(count[0]['count(`id`)']);
  }
  return workItemCount;
}

/**
 *  Returns the number of work items that can be actively worked for the given service ID
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job that created this work item
 * @param stepIndex - the index of the step in the workflow
 * @param status - a single status or list of statuses. If provided only work items with this status
 * (or status in the list) will be counted
 */
export async function getAvailableWorkItemCountByServiceID(tx: Transaction, serviceID: string)
  : Promise<number> {
  const count = await tx(WorkItem.table)
    .join(Job.table, `${WorkItem.table}.jobID`, '=', `${Job.table}.jobID`)
    .select()
    .count(`${WorkItem.table}.id`)
    .where({ serviceID })
    .whereIn(`${WorkItem.table}.status`, [WorkItemStatus.RUNNING, WorkItemStatus.READY])
    .whereIn(`${Job.table}.status`, [JobStatus.RUNNING, JobStatus.ACCEPTED, JobStatus.RUNNING_WITH_ERRORS]);

  let workItemCount;
  if (db.client.config.client === 'pg') {
    workItemCount = Number(count[0].count);
  } else {
    workItemCount = Number(Object.values(count[0])[0]);
  }
  return workItemCount;
}

/**
 * Get the scroll-id for a job if it has one
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the JobID
 * @returns A promise containing a scroll-id or null if the job does not use query-cmr
 */
export async function getScrollIdForJob(
  tx: Transaction,
  jobID: string,
): Promise<string> {
  const workItems = await getWorkItemsByJobIdAndStepIndex(tx, jobID, QUERY_CMR_STEP_INDEX);
  if (workItems && workItems.workItems[0]?.serviceID.match(/query-cmr/)) {
    return workItems.workItems[0]?.scrollID;
  }
  return null;
}

/**
 * Returns the sum of the work item sizes for all work items for the provided jobID.
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job
 */
export async function getTotalWorkItemSizeForJobID(
  tx: Transaction,
  jobID: string,
): Promise<number> {
  const results = await tx(WorkItem.table)
    .select()
    .sum('totalGranulesSize')
    .where({ jobID });

  let totalSize;
  if (db.client.config.client === 'pg') {
    totalSize = Number(results[0].sum);
  } else {
    totalSize = Number(results[0]['sum(`totalGranulesSize`)']);
  }

  return totalSize;
}

const MIN_WORK_ITEMS_FOR_DURATION = 3;
const MAX_WORK_ITEMS_FOR_DURATION = 10;
const PERCENT_WORK_ITEMS_FOR_DURATION = 0.01;
const MAX_WORK_ITEMS_WINDOW_FOR_DURATION = 100;

/**
 * Compute the threshold (in milliseconds) to be used to expire work items for a given job/service
 * 
 * @param jobID - the ID of the Job for the step
 * @param serviceID - the serviceID of the step within the workflow
 */
export async function computeWorkItemDurationOutlierThresholdForJobService(
  jobID: string,
  serviceID: string,
): Promise<number> {
  // default to two hours if we don't have enough samples to compute a meaningful value
  let threshold = 7200000;

  try {
    const results = await db(WorkItem.table)
      .select('duration')
      .where({
        jobID,
        serviceID,
        'status': 'successful',
      })
      .limit(MAX_WORK_ITEMS_WINDOW_FOR_DURATION);

    const workflowStep = await getWorkflowStepByJobIdServiceId(db, jobID, serviceID, ['workItemCount']);
    const { workItemCount } = workflowStep;

    // this is a simple heuristic to determine the minimum number of successful work items
    // we need in order to compute a meaningful threshold. we always need at least 
    // MIN_WORK_ITEMS_FOR_DURATION successful,
    // but for larger jobs we want at least PERCENT_WORK_ITEMS_FOR_DURATION of the number of work 
    // items in the step or , whichever is smaller
    const minSuccessful = Math.max(Math.min(PERCENT_WORK_ITEMS_FOR_DURATION * workItemCount,
      MAX_WORK_ITEMS_FOR_DURATION), MIN_WORK_ITEMS_FOR_DURATION);
    logger.debug(`Minimum number of successful work items for thresholding is ${minSuccessful}`);

    if (results.length >= minSuccessful) {
      // compute an upper boundary to identify outliers using the IQR method with the 
      // durations of the successful work items, but assume that
      // no successful run can be an outlier. so if the IQR method gives a threshold that is
      // too low, set the threshold to 1.5 times the duration of the longest running successful
      // work item
      const durations = results.map(result => result.duration);
      threshold = quantile(durations, 0.75)
        + 1.5 * interquartileRange(durations);
      const maxSuccessfulDuration = max(durations);
      if (threshold < 1.5 * maxSuccessfulDuration) {
        threshold = 1.5 * maxSuccessfulDuration;
      }
    } else {
      logger.debug('Using default threshold');
    }
    logger.debug(`Threshold is ${threshold}`);

  } catch (e) {
    logger.error(`Failed to get work item times for service ${serviceID} of job ${jobID}`);
  }

  return threshold;

}