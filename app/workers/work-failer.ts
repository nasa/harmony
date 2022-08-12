import { Logger } from 'winston';
import { getWorkItemsByAgeAndStatus } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';
import { Job } from '../models/job';
import { WorkItemStatus } from '../models/work-item-interface';
import { proccessWorkItemUpdate } from '../backends/workflow-orchestration';

export interface WorkFailerConfig {
  logger: Logger;
}

/**
 * Fails/retries the work items that are taking too long to complete.
 * (WorkItem failures are persisted when no retries are left.)
 */
export default class WorkFailer implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkFailerConfig) {
    this.logger = config.logger;
  }

  /**
   * Find work items that're older than olderThanMinutes and call proccessWorkItemUpdate
   * which will either result in the item being failed or retried depending on the number
   * of retries that are left.
   * @param olderThanMinutes - upper limit on work item age
   * @returns \{ workItemIds: number[], jobIds: string[] \}
   */
  async proccessWorkItemUpdates(olderThanMinutes: number): Promise<{ workItemIds: number[], jobIds: string[] }> {
    let response: {
      workItemIds: number[],
      jobIds: string[]
    };
    const workItems = await getWorkItemsByAgeAndStatus(
      db, olderThanMinutes, [WorkItemStatus.RUNNING],
    );
    if (workItems.length) {
      const workItemIds = workItems.map((item) => item.id);
      const jobIds = new Set(workItems.map((item) => item.jobID));
      for (const jobId of jobIds) {
        try {
          const job = await Job.byJobID(db, jobId, false, true);
          const itemsForJob = workItems.filter((item) => item.jobID == job.jobID);
          for (const item of itemsForJob) { 
            proccessWorkItemUpdate(
              db, WorkItemStatus.FAILED, [],
              null, item.scrollID, 
              `Work item took too long (more than ${olderThanMinutes} minutes) to complete.`,
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
        await this.proccessWorkItemUpdates(
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
