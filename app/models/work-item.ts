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
  'stacCatalogLocation', 'workflowStepId',
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

  // The location of the STAC catalog for the item(s) to process
  stacCatalogLocation?: string;

  // The corresponding workflow step ID for the work item - used to look up the operation
  workflowStepId: number;

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
  const workItem = await tx(WorkItem.table)
    .forUpdate()
    .select(...tableFields, `${WorkflowStep.table}.operation`)
    .join(WorkflowStep.table, `${WorkflowStep.table}.id`, `${WorkItem.table}.workflowStepId`)
    .where({ 'work_items.serviceID': serviceID, status: WorkItemStatus.READY })
    .orderBy([`${WorkItem.table}.id`])
    .first();

  if (workItem) {
    workItem.operation = JSON.parse(workItem.operation);
    await tx(WorkItem.table)
      .update({ status: WorkItemStatus.RUNNING, updatedAt: new Date() })
      .where({ id: workItem.id });
  }

  // TODO - what does this do if `workItem` is null?
  return new WorkItem(workItem);
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
  const workItem = await tx(WorkItem.table)
    .select()
    .where({ id })
    .first();

  // TODO - what does this do if `workItem` is null?
  return new WorkItem(workItem);
}
