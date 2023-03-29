/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from 'winston';
import WorkItem, { computeWorkItemDurationOutlierThresholdForJobService, getWorkItemsByUpdateAgeAndStatus } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';
import { JobStatus } from '../models/job';
import { WorkItemStatus } from '../models/work-item-interface';
import { handleWorkItemUpdateWithJobId } from '../backends/workflow-orchestration';

export interface WorkFailerConfig {
  logger: Logger;
}

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

/**
 * Returns the chunked array based on the given array and chunkSize
 *
 * @param array - the original array to be split into chunks. It will be modified as a result of this function call.
 *                We do this to save on the memory usage.
 * @param chunkSize - the chunk size
 * @returns the chunked arrays of chunkSize
 */
function chunkArray(array: any[], chunkSize: number): any[][] {
  const chunkedArray: any[][] = [];
  while (array.length > 0) {
    chunkedArray.push(array.splice(0, chunkSize));
  }
  return chunkedArray;
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
   * Get expired work items that are older than lastUpdateOlderThanMinutes.
   * @param lastUpdateOlderThanMinutes - upper limit on the duration since the last update
   * @returns The expired work items and jobServiceThresholds for bookkeeping purpose
   */
  async getExpiredWorkItems(lastUpdateOlderThanMinutes: number): Promise<{ workItems: WorkItem[], jobServiceThresholds: Record<string, number> }> {
    let expiredWorkItems = [];
    const jobServiceThresholds = {};
    const workItems = await getWorkItemsByUpdateAgeAndStatus(
      db, lastUpdateOlderThanMinutes, [WorkItemStatus.RUNNING],
      [JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS],
      ['w.id', 'w.jobID', 'serviceID', 'startedAt', 'workflowStepIndex'],
    );
    if (workItems?.length > 0) {
      // compute duration thresholds for each job/service
      for (const workItem of workItems) {
        const { jobID, serviceID, workflowStepIndex } = workItem;
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

    return { workItems: expiredWorkItems, jobServiceThresholds: jobServiceThresholds };
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

    const { workItems, jobServiceThresholds } = await this.getExpiredWorkItems(lastUpdateOlderThanMinutes);

    if (workItems?.length > 0) {
      const workItemIds = workItems.map((item) => item.id);
      const jobIds = new Set<string>();

      // process the expired work items in batches
      const batchSize = env.workFailerBatchSize || 100;
      const batches = chunkArray(workItems, batchSize);
      for (const batch of batches){
        for (const workItem of batch) {
          this.logger.warn(`expiring work item ${workItem.id}`, { workItemId: workItem.id });
        }
        const batchJobIds = new Set(batch.map((item) => item.jobID));
        for (const jobId of batchJobIds) {
          jobIds.add(jobId);
          try {
            const itemsForJob = batch.filter((item) => item.jobID === jobId);
            await Promise.all(itemsForJob.map((item) => {
              const workItemLogger = this.logger.child({ workItemId: item.id });
              const key = `${jobId}${item.serviceID}`;
              const message = failedMessage(item.id, jobServiceThresholds[key]);
              workItemLogger.debug(message);
              return handleWorkItemUpdateWithJobId(
                jobId,
                { workItemID: item.id, status: WorkItemStatus.FAILED,
                  scrollID: item.scrollID, hits: null, results: [], totalItemsSize: item.totalItemsSize,
                  errorMessage: message,
                },
                null,
                workItemLogger);
            }));
          } catch (e) {
            this.logger.error(`Error attempting to process work item updates for job ${jobId}.`);
            this.logger.error(e);
          }
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
