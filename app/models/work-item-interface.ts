import DataOperation from './data-operation';
import { resolve } from '../util/url';
import env from '../util/env';

export enum WorkItemStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export const COMPLETED_WORK_ITEM_STATUSES = [
  WorkItemStatus.SUCCESSFUL,
  WorkItemStatus.FAILED,
  WorkItemStatus.CANCELED,
];

export interface WorkItemRecord {
  // The database ID for the record
  id: number;

  // The ID of the job that created this work item
  jobID: string;

  // The ID of the scroll session (only used for the query cmr service)
  scrollID?: string;

  // The number of cmr hits (only used for the query cmr service)
  hits?: number;

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

  // The sum of the sizes of the granules associated with this work item
  totalGranulesSize?: number;

  // The last time the record was updated
  updatedAt: Date;

  // When the item was created
  createdAt: Date;
}

/**
 * Get the s3 URL to the STAC outputs directory for a work item.
 * Optionally pass in a target URL in which case the URL returned will be the target URL
 * resolved relative to the STAC outputs directory.
 * e.g. s3://artifacts/abc/123/outputs/ with a targetUrl of ./catalog0.json or catalog0.json would resolve to
 * s3://artifacts/abc/123/outputs/catalog0.json
 * @param item - the returned URL will provide the path to the outputs for this work item
 * @param targetUrl - URL to resolve against the base outptuts directory 
 * @param isAggregate - include the word aggregate in the URL
 * @returns - the path to the STAC outputs directory (e.g. s3://artifacts/abc/123/outputs/) or the full path to the target URL
 */
export function getStacLocation(item: { id: number, jobID: string }, targetUrl = '', isAggregate = false): string {
  const baseUrl = `s3://${env.artifactBucket}/${item.jobID}/${isAggregate ? 'aggregate-' : ''}${item.id}/outputs/`;
  return resolve(baseUrl, targetUrl);
}