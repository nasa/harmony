import { Transaction } from '../util/db';
import Record from './record';

export interface BatchRecord {

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // A sequential number identifying the batch for a given job/service. batchID preserves the
  // order in which the batches for a given job/service are created.
  batchID: number;
}

/**
 *
 * Wrapper object for persisted batches of granule for aggregation steps
 *
 */
export class Batch extends Record implements BatchRecord {
  static table = 'batches';

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // A sequential number identifying the batch for a given job/service. batchID preserves the
  // order in which the batches for a given job/service are created.
  batchID: number;
}

/**
 * Get the Batch with the hightest batchID for the given job/service
 *
 * @param tx - The dB transaction to use
 * @param jobID - The ID of the associated job
 * @param serviceID - The ID of the associated service
 */
export async function withHighestBatchIDForJobService(
  tx: Transaction,
  jobID: string,
  serviceID: string,
): Promise<Batch> {
  const result = await tx(Batch.table)
    .select()
    .where({
      jobID,
      serviceID,
    })
    .orderBy('batchID', 'desc')
    .first();

  const batch = result && new Batch(result);
  return batch;
}

