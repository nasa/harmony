import _ from 'lodash';
import { Transaction } from 'util/db';
import Record from './record';

export enum WorkItemStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkItem extends Record {
  static table = 'work_items';

  jobID: string;

  serviceID: string;

  status?: WorkItemStatus;

  stacItemLocation?: string;
}

/**
 * Returns the next work item to process for a service
 * @param transaction - the transaction to use for querying
 * @param serviceID - the service ID looking for the next item to work
 *
 * @returns A promise with the work item to process or null if none
 */
export async function getNextWorkItem(
  transaction: Transaction,
  serviceID: string,
): Promise<WorkItem> {
  const workItem = await transaction('work_items')
    .select()
    .where({ serviceID, status: 'ready' })
    .orderBy(['id'])
    .first();

  if (workItem) {
    await transaction('work_items')
      .update({ status: 'running', updatedAt: new Date() })
      .where({ id: workItem.id });
  }

  return workItem as unknown as WorkItem;
}

/**
 * Returns the next work item to process for a service
 * @param transaction - the transaction to use for querying
 * @param id - the work item ID
 *
 * @returns A promise with the work item or null if none
 */
export async function getWorkItemById(
  transaction: Transaction,
  id: string,
): Promise<WorkItem> {
  const workItem = await transaction('work_items')
    .select()
    .where({ id })
    .first();

  return workItem;
}
