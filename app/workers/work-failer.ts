import { Logger } from 'winston';
import { getWorkItemsByUpdateAgeAndStatus } from '../models/work-item';
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
    const workItems = await getWorkItemsByUpdateAgeAndStatus(
      db, lastUpdateOlderThanMinutes, [WorkItemStatus.RUNNING],
      [JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS],
    );
    if (workItems.length) {
      const workItemIds = workItems.map((item) => item.id);
      const jobIds = new Set(workItems.map((item) => item.jobID));
      for (const jobId of jobIds) {
        try {
          const itemsForJob = workItems.filter((item) => item.jobID === jobId);
          await Promise.all(itemsForJob.map((item) => { 
            return handleWorkItemUpdate(
              { workItemID: item.id, status: WorkItemStatus.FAILED,
                scrollID: item.scrollID, hits: null, results: [], totalGranulesSize: item.totalGranulesSize,
                errorMessage: `Work item has not been updated for over ${lastUpdateOlderThanMinutes} minutes.` },
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
        `${jobIds.size} jobs and ${workItems.length} work items.`);
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
