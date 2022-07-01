import { subMinutes } from 'date-fns';
import { ILengthAwarePagination } from 'knex-paginate';
import _ from 'lodash';
import logger from '../util/log';
import db, { Transaction } from '../util/db';
import DataOperation from './data-operation';
import { activeJobStatuses, Job, JobStatus } from './job';
import Record from './record';
import WorkflowStep from './workflow-steps';
import { WorkItemRecord, WorkItemStatus, getStacLocation } from './work-item-interface';

// The step index for the query-cmr task. Right now query-cmr only runs as the first step -
// if this changes we will have to revisit this
const QUERY_CMR_STEP_INDEX = 1;

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'createdAt', 'updatedAt', 'scrollID', 'serviceID', 'status',
  'stacCatalogLocation', 'totalGranulesSize', 'workflowStepIndex',
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
  // The query-cmr service should keep going for paused jobs to avoid the ten minute CMR
  // scroll session timeout
  if (serviceID.includes('query-cmr')) {
    acceptableJobStatuses.push(JobStatus.PAUSED);
  }

  try {
    // query to get users that have active jobs that have available work items for the service
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
      let workItemDataQuery = tx(`${WorkItem.table} as w`)
        .forUpdate()
        .join(`${Job.table} as j`, 'w.jobID', 'j.jobID')
        .join(`${WorkflowStep.table} as wf`, function () {
          this.on('w.jobID', '=', 'wf.jobID')
            .on('w.workflowStepIndex', '=', 'wf.stepIndex');
        })
        .select(...tableFields, 'wf.operation')
        .whereIn('j.status', acceptableJobStatuses)
        .where('w.status', '=', 'ready')
        .where('w.serviceID', '=', serviceID)
        .where('j.username', '=', userData.username)
        .orderBy('j.isAsync', 'asc')
        .orderBy('j.updatedAt', 'asc')
        .first();

      if (db.client.config.client === 'pg') {
        workItemDataQuery = workItemDataQuery.skipLocked();
      }

      workItemData = await workItemDataQuery;

      if (workItemData) {
        workItemData.operation = JSON.parse(workItemData.operation);
        await tx(WorkItem.table)
          .update({ status: WorkItemStatus.RUNNING, updatedAt: new Date() })
          .where({ id: workItemData.id });
        // need to update the job otherwise long running jobs won't count against
        // the user's priority
        await tx(Job.table)
          .update({ updatedAt: new Date() })
          .where({ jobID: workItemData.jobID });
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
 * Update the status in the database for a WorkItem
 * @param tx - the transaction to use for querying
 * @param id - the id of the WorkItem
 * @param status - the status to set for the WorkItem
 * @param totalGranulesSize - the combined sizes of all the input granules for this work item
 */
export async function updateWorkItemStatus(
  tx: Transaction,
  id: string,
  status: WorkItemStatus,
  totalGranulesSize: number,
): Promise<void> {
  const workItem = await tx(WorkItem.table)
    .forUpdate()
    .select()
    .where({ id })
    .first() as WorkItem;

  if (workItem) {
    await tx(WorkItem.table)
      .update({ status, totalGranulesSize, updatedAt: new Date() })
      .where({ id: workItem.id });
  } else {
    throw new Error(`id [${id}] does not exist in table ${WorkItem.table}`);
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
 *
 * @returns A promise with the work item or null if none
 */
export async function getWorkItemById(
  tx: Transaction,
  id: number,
): Promise<WorkItem> {
  const workItemData = await tx(WorkItem.table)
    .select()
    .where({ id })
    .first();

  const workItem = workItemData && new WorkItem(workItemData);
  return workItem;
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
  const result = await tx(WorkItem.table)
    .select()
    .where({ jobID })
    .orderBy('id', sortOrder)
    .paginate({ currentPage, perPage, isLengthAware: true });

  return {
    workItems: result.data.map((i) => new WorkItem(i)),
    pagination: result.pagination,
  };
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
 * Get all WorkItems older than a particular age (minutes), that also have a particular status.
 * @param tx - the transaction to use for querying
 * @param olderThanMinutes - retrieve WorkItems with createdAt older than olderThanMinutes
 * @param statuses - only WorkItems with these statuses will be retrieved
 * @returns - all WorkItems that meet the olderThanMinutes and status constraints
*/
export async function getWorkItemsByAgeAndStatus(
  tx: Transaction,
  olderThanMinutes: number,
  statuses: WorkItemStatus[],
): Promise<WorkItem[]> {
  const pastDate = subMinutes(new Date(), olderThanMinutes);
  const workItems = (await tx(WorkItem.table)
    .select()
    .where(`${WorkItem.table}.createdAt`, '<', pastDate)
    .whereIn(`${WorkItem.table}.status`, statuses))
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
 *  Returns the number of existing work items for a specific service id and given statuses
 * @param tx - the transaction to use for querying
 * @param serviceID - the ID of the service
 */
export async function workItemCountByServiceIDAndStatus(
  tx: Transaction,
  serviceID: string,
  statuses: WorkItemStatus[],
): Promise<number> {
  const count = await tx(WorkItem.table)
    .select()
    .count('id')
    .where({ serviceID })
    .whereIn(`${WorkItem.table}.status`, statuses)
    ;

  let workItemCount;
  if (db.client.config.client === 'pg') {
    workItemCount = Number(count[0].count);
  } else {
    workItemCount = Number(count[0]['count(`id`)']);
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