import { Transaction } from '../util/db';
import Record from './record';
import { Batch } from './batch';

// The fields to save to the database
const serializedFields = ['id', 'jobID', 'serviceID', 'batchID', 'granuleUrl', 'granuleSize',
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
  itemUrl: string;

  // the size (in bytes) of the data
  itemSize: number;
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
  itemUrl: string;

  // the size (in bytes) of the data
  itemSize: number;
}

const tableFields = serializedFields.map((field) => `${BatchItem.table}.${field}`);

