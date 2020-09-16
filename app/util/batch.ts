import _ from 'lodash';
import DataOperation from 'models/data-operation';

/**
 * Return the total number of granule in the given operation
 * @param op The operation containing the granule sources
 * @returns The number of granules in the operation
 */
export function operationGranuleCount(op: DataOperation): number {
  return op.sources.reduce((total, source) => total + source.granules.length, 0);
}

/**
 * Split an operation into one or more operations to limit the number of granules in an operation.
 * This function first splits the operation along 'sources' to try to avoid splitting collections
 * across operations if it can be avoided.
 * @param op The operation to batch
 * @param batchSize The limit on the number of granules in a batch
 */
export function batchOperations(op: DataOperation, batchSize: number): DataOperation[] {
  if (batchSize < 0) {
    throw new Error('Batch size must be positive or unlimited (0)');
  }

  // if the number of granules requested is smaller than the allowed batch size of
  // the allowed batch size if unlimited (-1) then return a batch just consisting of the
  // original operation
  if (operationGranuleCount(op) <= batchSize || batchSize === 0) return [op];

  const batch: DataOperation[] = [];

  for (let i = 0; i < op.sources.length; i++) {
    const newOp = _.cloneDeep(op);
    newOp.sources = [newOp.sources[i]];
    batch.push(newOp);
  }

  const newBatch: DataOperation[] = [];

  for (const batchOp of batch) {
    let batchIndex = 0;
    const granuleCount = batchOp.sources[0].granules.length;
    while (batchIndex * batchSize < granuleCount) {
      const currentBatchSize = Math.min(granuleCount - batchSize * batchIndex, batchSize);
      const newOp = _.cloneDeep(batchOp);
      newOp.sources[0].granules = batchOp.sources[0].granules
        .slice(batchIndex * batchSize, batchIndex * batchSize + currentBatchSize);
      newBatch.push(newOp);
      batchIndex += 1;
    }
  }

  return newBatch;
}
