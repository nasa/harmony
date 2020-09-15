import _ from 'lodash';
import { assert } from 'console';
import DataOperation from 'models/data-operation';

/**
 * Split an operation into one or more operations to limit the number of granules in an operation
 * @param op The operation to batch
 * @param batchSize The limit on the number of granules in a batch
 */
export default function batchOperations(op: DataOperation, batchSize: number): DataOperation[] {
  assert(batchSize > 0);

  const granuleCount = op.granuleIds.length;
  if (granuleCount <= batchSize) return [op];

  const batch: DataOperation[] = [];
  const batchIndex = 0;
  while (batchIndex * batchSize < granuleCount) {
    const currentBatchSize = Math.min(granuleCount - batchSize * batchIndex, batchSize);
    const newOp = _.cloneDeep(op);
    newOp.granuleIds = op.granuleIds.slice(batchIndex * batchSize, currentBatchSize);
    batch.push(newOp);
  }

  return batch;
}
