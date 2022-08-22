import { Logger } from 'winston';
import { getWorkItemsByAgeAndStatus } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';
import { Job, JobStatus } from '../models/job';
import { WorkItemStatus } from '../models/work-item-interface';
import { processWorkItemUpdate } from '../backends/workflow-orchestration';

export interface WorkFailerConfig {
  logger: Logger;
}

/**
 * Calls the update work item route with status=FAILED for work items that are taking
 * too long to complete.
 */
export default class WorkFailer implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkFailerConfig) {
    this.logger = config.logger;
  }

  /**
   * Find work items that're older than lastUpdateOlderThanMinutes and call processWorkItemUpdate.
   * @param lastUpdateOlderThanMinutes - upper limit on the duration since the last update
   * @returns The ids of items and jobs that were processed: \{ workItemIds: number[], jobIds: string[] \}
   */
  async processWorkItemUpdates(lastUpdateOlderThanMinutes: number): Promise<{ workItemIds: number[], jobIds: string[] }> {
    let response: {
      workItemIds: number[],
      jobIds: string[]
    } = { workItemIds: [], jobIds: [] };
    const workItems = await getWorkItemsByAgeAndStatus(
      db, lastUpdateOlderThanMinutes, [WorkItemStatus.RUNNING],
      [JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS],
    );
    if (workItems.length) {
      const workItemIds = workItems.map((item) => item.id);
      const jobIds = new Set(workItems.map((item) => item.jobID));
      for (const jobId of jobIds) {
        try {
          const job = await Job.byJobID(db, jobId, false, true);
          const itemsForJob = workItems.filter((item) => item.jobID == job.jobID);
          for (const item of itemsForJob) { 
            processWorkItemUpdate(
              db, WorkItemStatus.FAILED, [],
              null, item.scrollID, 
              `Work item took too long (more than ${lastUpdateOlderThanMinutes} minutes) to complete.`,
              String(item.totalGranulesSize), item, job, this.logger)
              .catch((e) => {
                this.logger.error(`Work Failer encountered error for item ${item.id} (job ${jobId})`);
                this.logger.error(e);
              });
          }
        } catch (e) {
          this.logger.error(`Error attempting to proccess work item updates for job ${jobId}.`);
          this.logger.error(e);
        }
      }
      response = {
        jobIds: Array.from(jobIds.values()),
        workItemIds,
      };
      this.logger.info('Work failer proccessed work item updates for ' +
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
        await this.processWorkItemUpdates(
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
