import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseSchemaFile } from '../helpers/data-operation';
import DataOperation from '../../app/models/data-operation';
import { batchOperations, operationGranuleCount } from '../../app/util/batch';

const model = parseSchemaFile('multiple-collections-operation.json');
const operation: DataOperation = new DataOperation(model);

const expectedBatchModel1 = parseSchemaFile('batch1-operation.json');
const expectedBatchOp1: DataOperation = new DataOperation(expectedBatchModel1);
const expectedBatchModel2 = parseSchemaFile('batch2-operation.json');
const expectedBatchOp2: DataOperation = new DataOperation(expectedBatchModel2);
const expectedBatchModel3 = parseSchemaFile('batch3-operation.json');
const expectedBatchOp3: DataOperation = new DataOperation(expectedBatchModel3);
const expectedBatchModel4 = parseSchemaFile('batch4-operation.json');
const expectedBatchOp4: DataOperation = new DataOperation(expectedBatchModel4);
const expectedBatchModel5 = parseSchemaFile('batch5-operation.json');
const expectedBatchOp5: DataOperation = new DataOperation(expectedBatchModel5);

describe('util/batch', function () {
  describe('operationGranuleCount', function () {
    it('returns the total number of granules', function () {
      expect(operationGranuleCount(operation)).to.equal(20);
    });
  });

  describe('batchOperations', function () {
    it('returns the original operation if the granule count is lower than the batch size',
      function () {
        const result = batchOperations(operation, 21);
        expect(result.length).to.equal(1);
        expect(result[0]).to.eql(operation);
      });
    it('treats batch size of 0 as infinite (no batching)', function () {
      const result = batchOperations(operation, 0);
      expect(result.length).to.equal(1);
      expect(result[0]).to.eql(operation);
    });
    it('returns batches separated by collection and of the correct size', function () {
      const result = batchOperations(operation, 5);
      expect(result.length).to.equal(5);
      expect(result[0]).to.eql(expectedBatchOp1);
      expect(result[1]).to.eql(expectedBatchOp2);
      expect(result[2]).to.eql(expectedBatchOp3);
      expect(result[3]).to.eql(expectedBatchOp4);
      expect(result[4]).to.eql(expectedBatchOp5);
    });
  });
});
