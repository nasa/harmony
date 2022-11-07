import { Logger } from 'winston';
import { computeWorkItemDurationOutlierThresholdForJobService, getWorkItemsByUpdateAgeAndStatus } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';
import { JobStatus } from '../models/job';
import { WorkItemStatus } from '../models/work-item-interface';
import { handleWorkItemUpdate } from '../backends/workflow-orchestration';

export interface WorkFailerConfig {
  logger: Logger;
}

/**
 * Construct a message indicating that the given work item has exceeded the given duration
 * 
 * @param item - the work item that is being failed
 * @param duration - the duration threshold that the work item has exceeded
 * @returns 
 */
function failedMessage(itemId: number, duration: number): string {
  return `Work item ${itemId} has exceeded the ${duration} ms duration threshold.`;
}

/**
 * Updates work items to status=FAILED for work items that haven't been updated
 * for a specified duration (env.workFailerPeriodSec). If retries haven't been exhausted,
 * work item statuses may be reset to READY instead.
 */
export default class WorkFailer implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkFailerConfig) {
    this.logger = config.logger;
  }

  /**
   * Find work items that're older than lastUpdateOlderThanMinutes and call handleWorkItemUpdate.
   * @param lastUpdateOlderThanMinutes - upper limit on the duration since the last update
   * @returns The ids of items and jobs that were processed: \{ workItemIds: number[], jobIds: string[] \}
   */
  async handleWorkItemUpdates(lastUpdateOlderThanMinutes: number): Promise<{ workItemIds: number[], jobIds: string[] }> {
    let response: {
      workItemIds: number[],
      jobIds: string[]
    } = { workItemIds: [], jobIds: [] };
    const jobServiceThresholds = {};
    const workItems = await getWorkItemsByUpdateAgeAndStatus(
      db, lastUpdateOlderThanMinutes, [WorkItemStatus.RUNNING],
      [JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS],
      ['w.id', 'w.jobID', 'serviceID', 'startedAt'],
    );
    if (workItems?.length > 0) {
      // compute duration thresholds for each job/service
      for (const workItem of workItems) {
        const { jobID, serviceID } = workItem;
        const key = `${jobID}${serviceID}`;
        if (!jobServiceThresholds[key]) {
          const outlierThreshold = await computeWorkItemDurationOutlierThresholdForJobService(jobID, serviceID);
          jobServiceThresholds[key] = outlierThreshold;
        }
      }
      const expiredWorkItems = workItems.filter((item) => {
        const { jobID, serviceID } = item;
        const key = `${jobID}${serviceID}`;
        const threshold = jobServiceThresholds[key];
        const runningTime = Date.now() - item.startedAt.valueOf();
        return runningTime > threshold;
      });
      const workItemIds = expiredWorkItems.map((item) => item.id);
      for (const workItem of expiredWorkItems) {
        this.logger.warn(`expiring work item ${workItem.id}`);
      }
      const jobIds = new Set(workItems.map((item) => item.jobID));
      for (const jobId of jobIds) {
        try {
          const itemsForJob = expiredWorkItems.filter((item) => item.jobID === jobId);
          await Promise.all(itemsForJob.map((item) => {
            const key = `${jobId}${item.serviceID}`;
            const message = failedMessage(item.id, jobServiceThresholds[key]);
            this.logger.debug(message);
            return handleWorkItemUpdate(
              { workItemID: item.id, status: WorkItemStatus.FAILED,
                scrollID: item.scrollID, hits: null, results: [], totalItemsSize: item.totalItemsSize,
                errorMessage: message,
              },
              null,
              this.logger);
          }));
        } catch (e) {
          this.logger.error(`Error attempting to process work item updates for job ${jobId}.`);
          this.logger.error(e);
        }
      }
      response = {
        jobIds: Array.from(jobIds.values()),
        workItemIds,
      };
      this.logger.info('Work failer processed work item updates for ' +
        `${jobIds.size} jobs and ${workItemIds.length} work items.`);
    }
    return response;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    let firstRun = true;
    while (this.isRunning) {
      if (!firstRun) {
        await sleep(env.workFailerPeriodSec * 1000);
      }
      this.logger.info('Starting work failer');
      try {
        await this.handleWorkItemUpdates(
          env.failableWorkAgeMinutes,
        );
      } catch (e) {
        this.logger.error('Work failer encountered an unexpected error');
        this.logger.error(e);
      } finally {
        firstRun = false;
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}
