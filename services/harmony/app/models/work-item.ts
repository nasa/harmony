/* eslint-disable @typescript-eslint/dot-notation */
import { subMinutes } from 'date-fns';
import { ILengthAwarePagination } from 'knex-paginate';
import _ from 'lodash';
import logger from '../util/log';
import db, { Transaction } from '../util/db';
import DataOperation from './data-operation';
import env from '../util/env';
import { Job, JobStatus } from './job';
import Record from './record';
import WorkflowStep from './workflow-steps';
import { WorkItemRecord, WorkItemStatus, getStacLocation, WorkItemQuery } from './work-item-interface';
import { eventEmitter } from '../events';
import { getWorkSchedulerQueue } from '../../app/util/queue/queue-factory';

// The step index for the query-cmr task. Right now query-cmr only runs as the first step -
// if this changes we will have to revisit this
const QUERY_CMR_STEP_INDEX = 1;

// Events emitted by this class
export enum WorkItemEvent {
  CREATED = 'work-item-created',
  UPDATED = 'work-item-updated',
  DELETED = 'work-item-deleted',
}

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'createdAt', 'retryCount', 'updatedAt', 'scrollID', 'serviceID', 'status',
  'stacCatalogLocation', 'totalItemsSize', 'workflowStepIndex', 'duration', 'startedAt',
  'sortIndex', 'message_category',
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

  // Additional information about the message returned from the service
  message_category?: string;

  // error or warning message if status === FAILED or status === WARNING
  message?: string;

  // The location of the STAC catalog for the item(s) to process
  stacCatalogLocation?: string;

  // The corresponding workflow step ID for the work item - used to look up the operation
  workflowStepIndex: number;

  // The string representation of the data operation to be performed by the service (not serialized)
  operation?: DataOperation;

  // The location of the resulting STAC catalog(s) (not serialized)
  results?: string[];

  // The sum of the sizes of the granules associated with this work item
  totalItemsSize?: number;

  // The size (in bytes) of each STAC item produced by this work item (used for batching)
  outputItemSizes?: number[];

  // The number of times this work-item has been retried
  retryCount: number;

  // When the work item started processing
  startedAt?: Date;

  // How long in milliseconds the work item took to process
  duration: number;

  // The position of the work item output in any following aggregation
  sortIndex: number;

  /**
   * Saves the work item to the database using the given transaction.
   *
   * @param transaction - The transaction to use for saving the job link
   */
  async save(transaction: Transaction): Promise<void> {
    const isUpdate = !!this.id;
    const record = _.pick(this, serializedFields);
    await super.save(transaction, record);
    if (isUpdate) {
      eventEmitter.emit(WorkItemEvent.UPDATED, this);
    } else {
      eventEmitter.emit(WorkItemEvent.CREATED, this);
    }
  }

  /**
   * Saves the work items to the database using a single SQL statement.
   *
   * @param transaction - The transaction to use for saving the job link
   * @param workItems - The work items to save
   */
  static async insertBatch(transaction: Transaction, workItems: WorkItem[]): Promise<void> {
    const fieldsList = workItems.map(item => _.pick(item, serializedFields));
    // only send one event for all the work items as they will all have the same serviceID
    let isUpdate;
    let workItem;
    if (workItems.length > 0) {
      workItem = workItems[0];
      isUpdate = !!workItem.id;
    }
    await super.insertBatch(transaction, workItems, fieldsList);
    if (workItem) {
      if (isUpdate) {
        eventEmitter.emit(WorkItemEvent.UPDATED, workItem);
      } else {
        eventEmitter.emit(WorkItemEvent.CREATED, workItem);
      }
    }
  }

  /**
   * Get the s3 URL to the STAC outputs directory for this work item.
   * Optionally pass in a target URL in which case the URL returned will be the target URL
   * resolved relative to the STAC outputs directory.
   * e.g. s3://artifacts/abc/123/outputs/ with a targetUrl of ./catalog0.json or catalog0.json would resolve to
   * s3://artifacts/abc/123/outputs/catalog0.json
   * @param targetUrl - URL to resolve against the base outputs directory
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
 * Returns the next work item to process for a service and job ID
 * @param tx - the transaction to use for querying
 * @param serviceID - the service ID looking for the next item to work
 * @param jobID - - the jobID for the next item to work
 *
 * @returns A promise with the work item to process or null if none
 */
export async function getNextWorkItem(
  tx: Transaction,
  serviceID: string,
  jobID: string,
): Promise<WorkItem> {
  let workItemData;
  try {
    const workflowStepData = await tx(WorkflowStep.table)
      .select(['operation'])
      .where('jobID', '=', jobID)
      .andWhere({ serviceID })
      .first();

    if (workflowStepData?.operation) {
      const { operation } = workflowStepData;
      let workItemDataQuery = tx(`${WorkItem.table} as w`)
        .forUpdate()
        .select(tableFields)
        .where('w.jobID', '=', jobID)
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
        // Make sure that the staging location is unique for every work item in a job
        // in case a service for the same job produces an output with the same file name
        workItemData.operation.stagingLocation += `${workItemData.id}/`;
        const startedAt = new Date();
        let status = WorkItemStatus.RUNNING;
        if (env.useServiceQueues) {
          status = WorkItemStatus.QUEUED;
        }
        await tx(WorkItem.table)
          .update({
            status,
            updatedAt: startedAt,
            startedAt,
          })
          .where({ id: workItemData.id });
      }
    }
  } catch (e) {
    logger.error(`Error getting next work item for service [${serviceID}] and job [${jobID}]`);
    logger.error(e);
    throw e;
  }

  return workItemData && new WorkItem(workItemData);
}

/**
 * Returns the next work items to process for a service and job ID
 * @param tx - the transaction to use for querying
 * @param serviceID - the service ID looking for the next item to work
 * @param jobID - - the jobID for the next item to work
 * @param workSize - - the size of work items to return
 *
 * @returns A promise with a list of work items to process or null if none
 */
export async function getNextWorkItems(
  tx: Transaction,
  serviceID: string,
  jobID: string,
  workSize: number,
): Promise<WorkItem[]> {
  let workItemData;
  try {
    let workItemDataQuery = tx(`${WorkItem.table} as w`)
      .forUpdate()
      .select(tableFields)
      .where('w.jobID', '=', jobID)
      .where('w.status', '=', 'ready')
      .where('w.serviceID', '=', serviceID)
      .orderBy('w.id', 'asc')
      .limit(workSize);

    if (db.client.config.client === 'pg') {
      workItemDataQuery = workItemDataQuery.skipLocked();
    }

    workItemData = await workItemDataQuery;

    if (workItemData?.length > 0) {
      const startedAt = new Date();
      let status = WorkItemStatus.RUNNING;
      if (env.useServiceQueues) {
        status = WorkItemStatus.QUEUED;
      }
      await tx(WorkItem.table)
        .update({
          status,
          updatedAt: startedAt,
          startedAt,
        })
        .whereIn('id', workItemData.map((w) => w.id));
    }
  } catch (e) {
    logger.error(`Error getting next work items for service [${serviceID}] and job [${jobID}]`);
    logger.error(e);
    throw e;
  }

  return workItemData && workItemData.map((w) => new WorkItem(w));
}

/**
 * Returns the status of a work item as read from the database
 *
 * @param tx - the transaction to use for querying
 * @param id - the id of the work item to get the status for
 * @returns A promise with the status of the work item
 */
export async function getWorkItemStatus(
  tx: Transaction,
  id: number,
): Promise<WorkItemStatus> {
  try {
    const workItemData = await tx(WorkItem.table)
      .select(['status'])
      .where({ id })
      .first();
    if (workItemData) {
      return workItemData.status;
    } else {
      throw new Error(`Work item [${id}] not found`);
    }
  } catch (e) {
    logger.error(`Error getting status for work item [${id}]`);
    logger.error(e);
    throw e;
  }
}

/**
 * Update the status and duration in the database for a WorkItem
 * @param tx - the transaction to use for querying
 * @param id - the id of the WorkItem
 * @param status - the status to set for the WorkItem
 * @param message_category - the message category to set for the WorkItem
 * @param duration - how long the work item took to process
 * @param totalItemsSize - the combined sizes of all the input granules for this work item
 * @param outputItemSizes - the separate size of each granule in the output for this work item
 */
export async function updateWorkItemStatus(
  tx: Transaction,
  id: number,
  status: WorkItemStatus,
  message_category: string,
  duration: number,
  totalItemsSize: number,
  outputItemSizes: number[],
): Promise<void> {
  logger.debug(`updatedWorkItemStatus: Updating status for work item ${id} to ${status}`);
  const outputItemSizesJson = JSON.stringify(outputItemSizes);
  try {
    await tx(WorkItem.table)
      .update({ status, message_category, duration, totalItemsSize, outputItemSizesJson: outputItemSizesJson, updatedAt: new Date() })
      .where({ id });
    logger.debug(`Status for work item ${id} set to ${status} | ${message_category}`);
  } catch (e) {
    logger.error(`Failed to update work item ${id} status to ${status} | ${message_category}`);
    logger.error(e);
    throw e;
  }
}

/**
 * Update the statuses in the database for the given WorkItem ids
 * @param tx - the transaction to use for querying
 * @param ids - the ids of the WorkItems
 * @param status - the status to set for the WorkItems
 * @param message_category - the message category to set for the WorkItems
 */
export async function updateWorkItemStatuses(
  tx: Transaction,
  ids: number[],
  status: WorkItemStatus,
  message_category?: string,
): Promise<void> {
  const now = new Date();
  let update = { status, message_category, updatedAt: now };
  // if we are setting the status to running, also set the startedAt time
  if (status === WorkItemStatus.RUNNING) {
    update = { ...update, ...{ startedAt: now } };
  }
  await tx(WorkItem.table)
    .update(update)
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
): Promise<number> {
  const updatedAt = new Date();
  const numUpdated = await tx(WorkItem.table)
    .where({ jobID })
    .whereIn('status', oldStatuses)
    .update({ status: newStatus, updatedAt });
  return numUpdated;
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
  if (workItemData?.outputItemSizesJson) {
    workItem.outputItemSizes = JSON.parse(workItemData.outputItemSizesJson);
  }
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
      if (constraints.dates) {
        if (constraints.dates.from) {
          void queryBuilder.where(constraints.dates.field, '>=', constraints.dates.from);
        }
        if (constraints.dates.to) {
          void queryBuilder.where(constraints.dates.field, '<=', constraints.dates.to);
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
  )?.jobID;
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
 * @param startingId - the work item id to begin the query with, i.e. query work items with id greater than startingId
 * @param batchSize - the batch size
 * @returns - all work item ids associated with the jobs that
 * met the updatedAt and status constraints
 */
export async function getWorkItemIdsByJobUpdateAgeAndStatus(
  tx: Transaction,
  notUpdatedForMinutes: number,
  jobStatus: JobStatus[],
  startingId = 0,
  batchSize = 2000,
): Promise<number[]> {
  const pastDate = subMinutes(new Date(), notUpdatedForMinutes);
  const workItemIds = (await tx(`${WorkItem.table} as w`)
    .innerJoin(Job.table, 'w.jobID', '=', `${Job.table}.jobID`)
    .select(['w.id'])
    .where(`${Job.table}.updatedAt`, '<', pastDate)
    .whereIn(`${Job.table}.status`, jobStatus)
    .where('w.id', '>', startingId)
    .orderBy('w.id', 'asc')
    .limit(batchSize))
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
 * @param startingId - the work item id to begin the query with, i.e. query work items with id greater than startingId
 * @param batchSize - the batch size
 * @returns all WorkItems that meet the lastUpdateOlderThanMinutes and status constraints
*/
export async function getWorkItemsByUpdateAgeAndStatus(
  tx: Transaction,
  lastUpdateOlderThanMinutes: number,
  workItemStatuses: WorkItemStatus[],
  jobStatuses: JobStatus[],
  fields = tableFields,
  startingId = 0,
  batchSize = 1000,
): Promise<WorkItem[]> {
  const pastDate = subMinutes(new Date(), lastUpdateOlderThanMinutes);
  const workItems = (await tx(`${WorkItem.table} as w`)
    .innerJoin(Job.table, 'w.jobID', '=', `${Job.table}.jobID`)
    .select(...fields)
    .whereIn(`${Job.table}.status`, jobStatuses)
    .where('w.id', '>', startingId)
    .andWhere('w.updatedAt', '<', pastDate)
    .whereIn('w.status', workItemStatuses)
    .orderBy('w.id', 'asc')
    .limit(batchSize))
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
 * Compute the max sort index (used for batching) for the given job/service. This depends
 * on the previous service executing one at a time, such as query-cmr, otherwise table locking
 * or some other solution must be employed to ensure that simultaneous calls to this function
 * don't return the same sort index.
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job that created the work item
 * @param serviceID - the serviceID of the step within the workflow
 * @returns a promise containing the max stepIndex value or -1 if there are no matching rows
 */
export async function maxSortIndexForJobService(
  tx: Transaction,
  jobID: string,
  serviceID: string,
): Promise<number> {
  const result = await tx(WorkItem.table)
    .where({
      jobID,
      serviceID,
    })
    .max('sortIndex', { as: 'max' })
    .first();
  return result?.max == null ? -1 : result.max;
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
 *
 * @returns a promise resolving to an object with two keys containing the originalSize
 * in MB and the outputSize in MB for all items in the request.
 */
export async function getTotalWorkItemSizesForJobID(
  tx: Transaction,
  jobID: string,
): Promise<{ originalSize: number, outputSize: number }> {
  const workflowStepIndexResults = await tx(WorkflowStep.table)
    .select()
    .min('stepIndex')
    .max('stepIndex')
    .where({ jobID });

  let firstIndex, lastIndex;
  if (db.client.config.client === 'pg') {
    firstIndex = workflowStepIndexResults[0].min;
    lastIndex = workflowStepIndexResults[0].max;
  } else {
    firstIndex = workflowStepIndexResults[0]['min(`stepIndex`)'];
    lastIndex = workflowStepIndexResults[0]['max(`stepIndex`)'];
  }

  const originalSizeResults = await tx(WorkItem.table)
    .select()
    .sum('totalItemsSize')
    .where({ jobID, workflowStepIndex: firstIndex });

  let originalSize;
  if (db.client.config.client === 'pg') {
    originalSize = Number(originalSizeResults[0].sum);
  } else {
    originalSize = Number(originalSizeResults[0]['sum(`totalItemsSize`)']);
  }

  const outputSizeResults = await tx(WorkItem.table)
    .select()
    .sum('totalItemsSize')
    .where({ jobID, workflowStepIndex: lastIndex });

  let outputSize;
  if (db.client.config.client === 'pg') {
    outputSize = Number(outputSizeResults[0].sum);
  } else {
    outputSize = Number(outputSizeResults[0]['sum(`totalItemsSize`)']);
  }


  return { originalSize, outputSize };
}

/**
 * Compute the threshold (in milliseconds) to be used to expire work items for a given job/service
 *
 * @param jobID - the ID of the Job for the step
 * @param serviceID - the serviceID of the step within the workflow
 * @param workflowStepIndex - index of the step within the workflow
 */
export async function computeWorkItemDurationOutlierThresholdForJobService(
  jobID: string,
  serviceID: string,
  workflowStepIndex: number,
): Promise<number> {
  // default to two hours
  let threshold = 7200000;

  try {
    // use a simple heuristic of 2 times the longest duration of all the successful work items
    // for this job/service
    const completedWorkItemCount = await workItemCountForStep(db, jobID, workflowStepIndex, WorkItemStatus.SUCCESSFUL);
    if (completedWorkItemCount >= 2) {
      const result = await db(WorkItem.table)
        .where({
          jobID,
          serviceID,
          'status': WorkItemStatus.SUCCESSFUL,
        })
        .max('duration', { as: 'max' })
        .first();

      if (result && result.max > 0) {
        threshold = 2.0 * result.max;
      } else {
        logger.debug('Using default threshold');
      }
    }
    logger.debug(`Threshold is ${threshold}`);

  } catch (e) {
    logger.error(`Failed to get MAX duration for service ${serviceID} of job ${jobID}`);
  }

  return threshold;

}

// Listen for work items being created and put a message on the scheduler queue asking it to
// schedule some WorkItems for the service
eventEmitter.on(WorkItemEvent.CREATED, async (workItem: WorkItem) => {
  if (env.useServiceQueues) {
    const { serviceID } = workItem;
    logger.debug(`Work item created for service ${serviceID}, putting message on scheduler queue`);
    const queue = getWorkSchedulerQueue();
    await queue.sendMessage(serviceID);
  }
});

