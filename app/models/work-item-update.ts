import _ from 'lodash';
import { WorkItemStatus } from './work-item-interface';

/**
 *
 * Interface for work item updates
 *
 */
export default interface WorkItemUpdate {

  // the database ID of the related WorkItem
  workItemID: number;

  // The status of the operation - see WorkItemStatus
  status?: WorkItemStatus;

  // The ID of the scroll session (only used for the query cmr service)
  scrollID?: string;

  // The number of cmr hits (only used for the query cmr service)
  hits?: number;

  // The location of the resulting STAC catalog(s)
  results?: string[];

  // The sum of the sizes (in mb) of the granules associated with this work item
  totalGranulesSize?: number;

  // The size (in bytes) of each granule produced by this work item (used for batching)
  outputGranuleSizes?: number[];

  // error message if status === FAILED
  errorMessage?: string;

  // how long the work item took to process
  duration?: number;
}