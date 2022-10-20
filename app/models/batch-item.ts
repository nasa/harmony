import { Transaction } from './../util/db';
import Record from './record';

// The fields to save to the database
const serializedFields = ['id', 'jobID', 'serviceID', 'batchID', 'stacItemUrl', 'itemSize',
  'sortIndex', 'createdAt', 'updatedAt'];

export interface BatchItemRecord {

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // A sequential number identifying the batch for a given job/service. batchID preserves the
  // order in which the batches for a given job/service are created.
  batchID: number;

  // the download url (s3/http) of the data
  stacItemUrl: string;

  // the size (in bytes) of the data
  itemSize: number;

  // The position of the batch item in the following aggregation
  sortIndex: number;
}

/**
 * 
 * Wrapper object for persisted batches of granule for aggregation steps
 * 
 */
export default class BatchItem extends Record implements BatchItemRecord {
  static table = 'batch_items';

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // A sequential number identifying the batch for a given job/service. batchID preserves the
  // order in which the batches for a given job/service are created.
  batchID: number;

  // the download url (s3/http) of the data
  stacItemUrl: string;

  // the size (in bytes) of the data
  itemSize: number;

  // The position of the batch item in the following aggregation
  sortIndex: number;
}

const tableFields = serializedFields.map((field) => `${BatchItem.table}.${field}`);

/**
 * Get the maximum sort index for the given job, service, and batch.
 * 
 * @param tx - The database transaction
 * @param jobID - The ID of the job
 * @param serviceID - The ID of the service
 * @param batchID - The ID of the batch
 * @returns The maximum sort index
 */
export async function getMaxSortIndexForJobServiceBatch(
  tx: Transaction,
  jobID: string,
  serviceID: string,
  batchID: number): Promise<number> {
  const result = await tx(BatchItem.table)
    .where({
      jobID,
      serviceID,
      batchID,
    })
    .max('sortIndex', { as: 'max' })
    .first();

  return result?.max;
}

/**
 * Get all the batch items for a given job/service and (possibly unassigned) batch 
 * 
 * @param tx - The database transaction
 * @param jobID - The ID of the job
 * @param serviceID - The ID of the service
 * @param batchID - The ID of the batch - null for unassigned batch items
 * @param lock - Boolean flag to indicate whether or not to select for update
 * @param order - knex clause to set order of results, defaults to `['sortIndex', 'asc']`
 * @returns a promise containing an array of BatchItems
 */
export async function getByJobServiceBatch(
  tx: Transaction,
  jobID: string,
  serviceID: string,
  batchID?: number,
  lock = false,
  order = ['sortIndex', 'asc'],
): Promise<BatchItem[]> {
  let result;
  try {
    let query = tx(BatchItem.table)
      .select()
      .where({
        jobID,
        serviceID,
        batchID,
      });
    if (lock) {
      query = query.forUpdate();
    }
    query = query.orderBy(order[0], order[1]);
    result = await query;
  } catch (e) {
    console.log(e);
  }

  const rval = result.map(data => {
    // knex returns a string for a pg bigint, so we need to parse the itemSize
    // technically this only works for ints up to 53 bits, but that should be big enough
    // for any sizes we could have
    let { itemSize } = data;
    itemSize = itemSize ? parseInt(itemSize) : 0;
    return new BatchItem({ ...data, itemSize });
  });
  return rval;
}

/**
 * 
 * @param tx - The database transaction
 * @param jobID - The ID of the job
 * @param serviceID - The ID of the service
 * @param batchID - The ID of the batch - null for unassigned batch items
 * @returns a promise containing a map with the sum of the sizes (in bytes) of all the data items
 * and the number of data items in the batch
 */
export async function getCurrentBatchSizeAndCount(
  tx: Transaction,
  jobID: string,
  serviceID: string,
  batchID: number): Promise<{ sum: number, count: number }> {
  const result = await tx(BatchItem.table)
    .select(['itemSize'])
    .where({
      jobID,
      serviceID,
      batchID,
    });

  const count = result.length;
  let sum = 0;
  if (count > 0) {
    // knex returns a string for a pg bigint, so we need to parse the itemSize
    // technically this only works for ints up to 53 bits, but that should be big enough
    // for any sizes we could have
    sum = result.reduce((s, data) => s + parseInt(data.itemSize), 0);
  }
  return { sum, count };
}

