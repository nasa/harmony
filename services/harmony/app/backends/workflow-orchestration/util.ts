import { Logger } from 'winston';

import { Job } from '../../models/job';
import WorkItem, { workItemCountForStep } from '../../models/work-item';
import { WorkItemStatus } from '../../models/work-item-interface';
import { Transaction } from '../../util/db';
import env from '../../util/env';

export const QUERY_CMR_SERVICE_REGEX = /harmonyservices\/query-cmr:.*/;

/**
 * Calculate the granule page limit for the current query-cmr work item.
 * @param tx - database transaction to query with
 * @param workItem - current query-cmr work item
 * @param logger - a Logger instance
 * @returns a number used to limit the query-cmr task or undefined
 */
export async function calculateQueryCmrLimit(tx: Transaction, workItem: WorkItem, logger: Logger): Promise<number> {
  let queryCmrLimit = -1;
  if (workItem && QUERY_CMR_SERVICE_REGEX.test(workItem.serviceID)) { // only proceed if this is a query-cmr step
    const numInputGranules = await Job.getNumInputGranules(tx, workItem.jobID);
    const numSuccessfulQueryCmrItems = await workItemCountForStep(tx, workItem.jobID, 1, WorkItemStatus.SUCCESSFUL);
    queryCmrLimit = Math.max(0, Math.min(env.cmrMaxPageSize, numInputGranules - (numSuccessfulQueryCmrItems * env.cmrMaxPageSize)));
    logger.debug(`Limit next query-cmr task to no more than ${queryCmrLimit} granules.`);
  }
  return queryCmrLimit;
}

// TODO - can we get rid of this and just handle it in the test framework
/**
 * Empty function that will be overridden in tests. Not needed for runtime environments since
 * the scheduler pod will be running
 */
export async function processSchedulerQueue(_reqLogger: Logger): Promise<void> {
  // NOOP - this will be overridden in tests
}