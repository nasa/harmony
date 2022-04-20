import DataOperation from './data-operation';

export enum WorkItemStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

// Future-proofing for when we have other success statuses like 'SUCCESSFUL_WITH_WARNINGS'
export const SUCCESSFUL_WORK_ITEM_STATUSES = [WorkItemStatus.SUCCESSFUL];

export interface WorkItemRecord {
  // The database ID for the record
  id: number;

  // The ID of the job that created this work item
  jobID: string;

  // The ID of the scroll session (only used for the query cmr service)
  scrollID?: string;

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