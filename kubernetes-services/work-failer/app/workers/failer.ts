import _ from 'lodash';
import { JobStatus } from '../../../../app/models/job';
import WorkItem, { computeWorkItemDurationOutlierThresholdForJobService, getWorkItemsByUpdateAgeAndStatus } from '../../../../app/models/work-item';
import db from '../../../../app/util/db';
import log from '../../../../app/util/log';
import sleep from '../../../../app/util/sleep';
import { Worker } from '../../../../app/workers/worker';
import { WorkItemStatus } from '../../../../app/models/work-item-interface';
import { handleWorkItemUpdateWithJobId } from '../../../../app/backends/workflow-orchestration/work-item-updates';
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
   * @returns Resolves when the request is complete
   */
  async handleWorkItemUpdates(lastUpdateOlderThanMinutes: number): Promise<void> {
    let done = false;
    let startingId = 0;
    let numExpired = 0;
    const batchSize = env.workFailerBatchSize;
    log.info('Work failer processing started.');

    while (!done) {
      const { workItems, jobServiceThresholds, maxId: newId } = await this.getExpiredWorkItems(lastUpdateOlderThanMinutes, startingId, batchSize);

      if (newId > startingId) {
        if (workItems.length > 0) {
          numExpired += workItems.length;
          for (const workItem of workItems) {
            log.warn(`expiring work item ${workItem.id}`, { jobId: workItem.jobID, workItemId: workItem.id });
          }
          const jobIds = new Set(workItems.map((item) => item.jobID));
          for (const jobId of jobIds) {
            jobIds.add(jobId);
            try {
              const itemsForJob = workItems.filter((item) => item.jobID === jobId);
              await Promise.all(itemsForJob.map((item) => {
                const workItemlog = log.child({ workItemId: item.id });
                const key = `${jobId}${item.serviceID}`;
                const message = failedMessage(item.id, jobServiceThresholds[key]);
                workItemlog.debug(message);
                return handleWorkItemUpdateWithJobId(
                  jobId,
                  {
                    workItemID: item.id, status: WorkItemStatus.FAILED,
                    scrollID: item.scrollID, hits: null, results: [], totalItemsSize: item.totalItemsSize,
                    errorMessage: message,
                  },
                  null,
                  workItemlog);
              }));
            } catch (e) {
              log.error(`Error attempting to process work item updates for job ${jobId}.`);
              log.error(e);
            }
          }

          if (newId < (startingId + batchSize)) {
            done = true;
          }

          log.info('Work failer processed work item updates for ' +
            `${jobIds.size} jobs and ${workItems.length} work items, starting id: ${startingId}.`);
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
        await sleep(env.workReaperPeriodSec * 1000);
      }
      try {
        await this.handleWorkItemUpdates(
          env.failableWorkAgeMinutes,
        );
      } catch (e) {
        log.error('Work reaper failed to delete terminal work');
        log.error(e);
      } finally {
        firstRun = false;
      }
    }
  }
}
