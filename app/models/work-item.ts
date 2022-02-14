import { subMinutes } from 'date-fns';
import { ILengthAwarePagination } from 'knex-paginate';
import _ from 'lodash';
import logger from '../util/log';
import db, { Transaction } from '../util/db';
import DataOperation from './data-operation';
import { Job, JobStatus } from './job';
import Record from './record';
import WorkflowStep from './workflow-steps';

export enum WorkItemStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

// Future-proofing for when we have other success statuses like 'SUCCESSFUL_WITH_WARNINGS'
export const SUCCESSFUL_WORK_ITEM_STATUSES = [WorkItemStatus.SUCCESSFUL];

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'createdAt', 'updatedAt', 'scrollID', 'serviceID', 'status',
  'stacCatalogLocation', 'workflowStepIndex',
];

export interface WorkItemRecord {
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

  // The operation to be performed by the service (not serialized)
  operation?: DataOperation;

  // The location of the resulting STAC catalog(s) (not serialized)
  results?: string[];

  // The last time the record was updated
  updatedAt: Date;

  // When the item was created
  createdAt: Date;
}

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

  /**
   * Saves the work item to the database using the given transaction.
   *
   * @param transaction - The transaction to use for saving the job link
   */
  async save(transaction: Transaction): Promise<void> {
    const record = _.pick(this, serializedFields);
    await super.save(transaction, record);
  }
}

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
  try {
    const subQuery =
      tx(Job.table)
        .select('username')
        .join(`${WorkItem.table} as w`, `${Job.table}.jobID`, 'w.jobID')
        .where({ 'w.status': 'ready', serviceID });
    const userData = await tx(Job.table)
      .forUpdate()
      .join(WorkItem.table, `${Job.table}.jobID`, '=', `${WorkItem.table}.jobID`)
      .select(['username', 'serviceID', `${WorkItem.table}.serviceID`])
      .max(`${Job.table}.updatedAt`, { as: 'm' })
      .whereIn('username', subQuery)
      .groupBy('username')
      .orderBy('m', 'asc')
      .first();
    if (userData?.username) {
      workItemData = await tx(`${WorkItem.table} as w`)
        .forUpdate()
        .join(`${Job.table} as j`, 'w.jobID', 'j.jobID')
        .join(`${WorkflowStep.table} as wf`, 'w.jobID', 'wf.jobID')
        .select(...tableFields, 'wf.operation')
        .whereIn('j.status', ['running', 'accepted'])
        .where('w.status', '=', 'ready')
        .where('w.serviceID', '=', serviceID)
        .whereRaw('w.workflowStepIndex = wf.stepIndex')
        .where('j.username', '=', userData.username)
        .orderBy('j.isAsync', 'asc')
        .orderBy('j.updatedAt', 'asc')
        .first();

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
    throw e;
  }

  return workItemData && new WorkItem(workItemData);
}

/**
 * Update the status in the database for a WorkItem
 * @param tx - the transaction to use for querying
 * @param id - the id of the WorkItem
 * @param status - the status to set for the WorkItem
 */
export async function updateWorkItemStatus(
  tx: Transaction,
  id: string,
  status: WorkItemStatus,
): Promise<void> {
  const workItem = await tx(WorkItem.table)
    .forUpdate()
    .select()
    .where({ id })
    .first() as WorkItem;

  if (workItem) {
    await tx(WorkItem.table)
      .update({ status, updatedAt: new Date() })
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
  return tx(WorkItem.table)
    .where({ jobID })
    .modify((queryBuilder) => {
      if (oldStatuses.length) {
        queryBuilder
          .whereIn('status', oldStatuses);
      }
    })
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
