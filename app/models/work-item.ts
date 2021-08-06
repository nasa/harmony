import _ from 'lodash';
import { Transaction } from '../util/db';
import DataOperation from './data-operation';
import Record from './record';
import WorkflowStep from './workflow-steps';

export enum WorkItemStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'createdAt', 'updatedAt', 'scrollID', 'serviceID', 'status',
  'stacCatalogLocation', 'workflowStepIndex',
];

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkItem extends Record {
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

  // The operation to be performed by the service (not serialized)
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
  const tableFields = serializedFields.map((field) => `${WorkItem.table}.${field}`);
  const workItemData = await tx(WorkItem.table)
    .forUpdate()
    .select(...tableFields, `${WorkflowStep.table}.operation`)
    // eslint-disable-next-line func-names
    .join(WorkflowStep.table, function () {
      this
        .on(`${WorkflowStep.table}.stepIndex`, `${WorkItem.table}.workflowStepIndex`)
        .on(`${WorkflowStep.table}.jobID`, `${WorkItem.table}.jobID`);
    })
    .where({ 'work_items.serviceID': serviceID, status: WorkItemStatus.READY })
    .orderBy([`${WorkItem.table}.id`])
    .first();

  if (workItemData) {
    workItemData.operation = JSON.parse(workItemData.operation);
    await tx(WorkItem.table)
      .update({ status: WorkItemStatus.RUNNING, updatedAt: new Date() })
      .where({ id: workItemData.id });
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

  return workItemData && new WorkItem(workItemData);
}

/**
 *  Returns the number of existing work items for a specific workflow step
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the job that created this work item
 * @param stepIndex - the index of the step in the workflow
 * @param status - if provided only work items with this status will be counted
 */
export async function workItemCountForStep(
  tx: Transaction,
  jobID: string,
  stepIndex: number,
  status?: WorkItemStatus,
): Promise<number> {
  let whereClause: {} = {
    jobID, workflowStepIndex: stepIndex,
  };
  whereClause = status ? { ...whereClause, status } : whereClause;
  const count = await tx(WorkItem.table)
    .select()
    .count('id')
    .where(whereClause);

  // TODO not sure if this works with postgres
  return Number(count[0]['count(`id`)']);
}
