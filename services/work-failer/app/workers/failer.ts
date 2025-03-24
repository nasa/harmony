import _ from 'lodash';

import {
  handleWorkItemUpdateWithJobId,
} from '../../../harmony/app/backends/workflow-orchestration/work-item-updates';
import { JobStatus } from '../../../harmony/app/models/job';
import WorkItem, {
  getWorkItemsByUpdateAgeAndStatus, workItemCountForStep,
} from '../../../harmony/app/models/work-item';
import { WorkItemStatus } from '../../../harmony/app/models/work-item-interface';
import db from '../../../harmony/app/util/db';
import log from '../../../harmony/app/util/log';
import { WorkItemQueueType } from '../../../harmony/app/util/queue/queue';
import { getQueueForType } from '../../../harmony/app/util/queue/queue-factory';
import sleep from '../../../harmony/app/util/sleep';
import { Worker } from '../../../harmony/app/workers/worker';
import env from '../util/env';

/**
 * Construct a message indicating that the given work item has exceeded the given duration
 *
 * @param item - the work item that is being failed
 * @param duration - the duration threshold that the work item has exceeded
 * @returns the failure message
 */
function failedMessage(itemId: number, duration: number): string {
  return `Work item ${itemId} has exceeded the ${duration} ms duration threshold.`;
}

// A mapping for the default timeouts for services since some services such as
// aggregation services can be expected to take much longer
const serviceToDefaultTimeoutSeconds = {
  'concise': 900, // 15 minutes
};

/**
 * Retrieves the default timeout threshold for a given service ID.
 *
 * The service ID is a docker image tag which may include a namespace
 * (e.g. podaac/concise:0.10.0rc11). This function extracts the base service name
 * (e.g. concise) and checks if it has a predefined threshold.
 *
 * @param serviceID - the identifier of the service, which may include a namespace and version
 * @param env - an object containing configuration values, including the default timeout threshold
 * @returns the default timeout threshold in seconds if the service is recognized,
 * otherwise env.defaultTimeoutThreshold
 */
export function getDefaultTimeoutSeconds(serviceID: string): number {
  // Pull out the service name from the docker image tag without the group namespace or tag
  const lastPart = serviceID.includes('/') ? serviceID.split('/').pop() : serviceID;
  const serviceName = lastPart?.split(':')[0];

  if (serviceName && serviceToDefaultTimeoutSeconds.hasOwnProperty(serviceName)) {
    return serviceToDefaultTimeoutSeconds[serviceName];
  } else {
    return env.defaultTimeoutSeconds;
  }
}

/**
 * Compute the threshold (in milliseconds) to be used to expire work items for a given job/service
 *
 * @param jobID - the ID of the Job for the step
 * @param serviceID - the serviceID of the step within the workflow
 * @param workflowStepIndex - index of the step within the workflow
 */
export async function computeWorkItemDurationOutlierThresholdForJobService(
  jobID: string,
  serviceID: string,
  workflowStepIndex: number,
): Promise<number> {
  let threshold = getDefaultTimeoutSeconds(serviceID) * 1000;

  try {
    // use a simple heuristic of 2 times the longest duration of all the successful work items
    // for this job/service
    const completedWorkItemCount = await workItemCountForStep(db, jobID, workflowStepIndex, WorkItemStatus.SUCCESSFUL);
    if (completedWorkItemCount >= 1) {
      const result = await db(WorkItem.table)
        .where({
          jobID,
          serviceID,
          'status': WorkItemStatus.SUCCESSFUL,
        })
        .max('duration', { as: 'max' })
        .first();

      if (result && result.max > 0) {
        threshold = 2.0 * result.max;
      } else {
        log.debug('Using default timeout threshold');
      }
    }
    log.debug(`Timeout threshold for ${jobID} and ${serviceID} is ${threshold}`);

  } catch (e) {
    log.error(`Failed to get MAX duration for service ${serviceID} of job ${jobID}`);
  }

  return threshold;
}

export default class Failer implements Worker {

  /**
   * Get expired work items that are older than lastUpdateOlderThanMinutes.
   * @param lastUpdateOlderThanMinutes - upper limit on the duration since the last update
   * @param startingId - the work item id to begin the query with, i.e. query work items with id greater than startingId
   * @param batchSize - the batch size
   * @returns The expired work items and jobServiceThresholds and maxId for bookkeeping purpose
   */
  async getExpiredWorkItems(lastUpdateOlderThanMinutes: number, startingId: number, batchSize: number)
    : Promise<{ workItems: WorkItem[], jobServiceThresholds: Record<string, number>, maxId: number }> {
    let expiredWorkItems = [];
    let maxId = startingId;
    const jobServiceThresholds = {};

    const workItems = await getWorkItemsByUpdateAgeAndStatus(
      db, lastUpdateOlderThanMinutes, [WorkItemStatus.RUNNING, WorkItemStatus.QUEUED],
      [JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS],
      ['w.id', 'w.jobID', 'serviceID', 'startedAt', 'workflowStepIndex'],
      startingId,
      batchSize,
    );

    if (workItems?.length > 0) {
      // compute duration thresholds for each job/service
      for (const workItem of workItems) {
        const { id, jobID, serviceID, workflowStepIndex } = workItem;
        maxId = Math.max(maxId, id);
        const key = `${jobID}${serviceID}`;
        if (!jobServiceThresholds[key]) {
          const outlierThreshold = await computeWorkItemDurationOutlierThresholdForJobService(jobID, serviceID, workflowStepIndex);
          jobServiceThresholds[key] = outlierThreshold;
        }
      }
      expiredWorkItems = workItems.filter((item) => {
        const { jobID, serviceID } = item;
        const key = `${jobID}${serviceID}`;
        const threshold = jobServiceThresholds[key];
        const runningTime = Date.now() - item.startedAt.valueOf();
        return runningTime > threshold;
      });
    }

    return {
      workItems: expiredWorkItems,
      jobServiceThresholds: jobServiceThresholds,
      maxId: maxId,
    };
  }

  /**
   * Find work items that're older than lastUpdateOlderThanMinutes and call handleWorkItemUpdate.
   * @param lastUpdateOlderThanMinutes - upper limit on the duration since the last update
   * @param failerDisabledDelay - number of ms to sleep when the failer is disabled because
   * there are too many items on the work item update queue. Override to a small value in tests.
   * @returns Resolves when the request is complete
   */
  async handleWorkItemTimeouts(
    lastUpdateOlderThanMinutes: number,
    failerDisabledDelay = 20000,
  ): Promise<void> {
    let done = false;
    let startingId = 0;
    let numExpired = 0;
    let batchSize = env.workFailerBatchSize;
    log.info('Work failer processing started.');

    while (!done) {
      if (env.maxWorkItemsOnUpdateQueueFailer !== -1) {
        const smallUpdateQueue = getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE);
        const updateQueueCount = await smallUpdateQueue.getApproximateNumberOfMessages();
        if (updateQueueCount >= env.maxWorkItemsOnUpdateQueueFailer) {
          log.warn(`Work item update queue is too large with ${updateQueueCount} items, will not fail more work`);
          await sleep(failerDisabledDelay);
          continue;
        } else {
          const slotsAvailable = env.maxWorkItemsOnUpdateQueueFailer - updateQueueCount;
          batchSize = slotsAvailable < batchSize ? slotsAvailable : batchSize;
        }
      }
      const { workItems, jobServiceThresholds, maxId: newId } = await this.getExpiredWorkItems(lastUpdateOlderThanMinutes, startingId, batchSize);

      if (newId > startingId) {
        if (workItems.length > 0) {
          numExpired += workItems.length;
          for (const workItem of workItems) {
            log.warn(`expiring work item ${workItem.id}`, { jobId: workItem.jobID, workItemId: workItem.id });
          }
          const jobIDs = new Set(workItems.map((item) => item.jobID));
          for (const jobID of jobIDs) {
            jobIDs.add(jobID);
            try {
              const itemsForJob = workItems.filter((item) => item.jobID === jobID);
              await Promise.all(itemsForJob.map(async (item) => {
                const workItemlog = log.child({ workItemId: item.id });
                const key = `${jobID}${item.serviceID}`;
                const message = failedMessage(item.id, jobServiceThresholds[key]);
                workItemlog.debug(message);
                const workItemUpdate = {
                  workItemID: item.id, status: WorkItemStatus.FAILED, scrollID: item.scrollID,
                  hits: null, results: [], totalItemsSize: item.totalItemsSize, errorMessage: message,
                  workflowStepIndex: item.workflowStepIndex,
                };
                await handleWorkItemUpdateWithJobId(jobID, workItemUpdate, null, workItemlog);
              }));
            } catch (e) {
              log.error(`Error attempting to process work item updates for job ${jobID}.`);
              log.error(e);
            }
          }

          if (newId < (startingId + batchSize)) {
            done = true;
          }

          log.info('Work failer processed work item updates for ' +
            `${jobIDs.size} jobs and ${workItems.length} work items, starting id: ${startingId}.`);
        }
        startingId = newId;
      } else {
        done = true;
      }
    }
    log.info(`Work failer processing completed. Total work items updated: ${numExpired}`);
  }

  async start(): Promise<void> {
    let firstRun = true;
    log.info('Starting work failer');
    while (true) {
      if (!firstRun) {
        await sleep(env.workFailerPeriodSec * 1000);
      }
      try {
        await this.handleWorkItemTimeouts(
          env.failableWorkAgeMinutes,
        );
      } catch (e) {
        log.error('Work failer failed to delete terminal work');
        log.error(e);
      } finally {
        firstRun = false;
      }
    }
  }
}
