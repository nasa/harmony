import _ from 'lodash';
import { Transaction } from './../util/db';
import Record from './record';
import { WorkItemStatus, WorkItemUpdateRecord } from './work-item-interface';

// The fields to save to the database
const serializedFields = [
  'id', 'workItemID', 'createdAt', 'updatedAt', 'scrollID', 'status',
  'hits', 'totalGranulesSize', 'errorMessage',
];

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkItemUpdate extends Record implements WorkItemUpdateRecord {
  static table = 'work_item_updates';

  // the database ID of the related WorkItem
  workItemID: number;

  // The status of the operation - see WorkItemStatus
  status?: WorkItemStatus;

  // The ID of the scroll session (only used for the query cmr service)
  scrollID?: string;

  // The number of cmr hits (only used for the query cmr service)
  hits?: number;

  // The location of the resulting STAC catalog(s) - array serialized into a JSON string
  serializedResults?: string;

  // The sum of the sizes of the granules associated with this work item
  totalGranulesSize?: number;

  // error message if status === FAILED
  errorMessage?: string;


  public get results(): string[] {
    return this.serializedResults ? JSON.parse(this.serializedResults) : [];
  }

  /**
  * Saves the work item update to the database using the given transaction.
  *
  * @param tx - The transaction to use for saving the job link
  * @returns an empty promise
  */
  async save(tx: Transaction): Promise<void> {
    const record = _.pick(this, serializedFields);
    await super.save(tx, record);
  }

  /**
   * Deletes the work item update from the database.
   * 
   * @param tx - The transaction to use for saving the job link
   * @returns an empty promise
   */
  async delete(tx: Transaction): Promise<void> {
    return tx(WorkItemUpdate.table)
      .where('id', this.id)
      .delete();
  }
}

/**
 * 
 * @param tx - the transaction to use for querying
 * @returns A WorkItemUpdate
 */
export async function getNextWorkItemUpdate(
  tx: Transaction,
): Promise<WorkItemUpdate> {
  const workItemUpdateData =
    tx(WorkItemUpdate.table)
      .select()
      .orderBy('createdAt', 'asc')
      .limit(1)
      .forUpdate();
  return workItemUpdateData ? new WorkItemUpdate(workItemUpdateData) : null;
}