import { Logger } from 'winston';
import { getWorkItemsByAgeAndStatus, updateWorkItemStatuses } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db, { Transaction } from '../util/db';
import sleep from '../util/sleep';
import { Job, JobStatus } from '../models/job';
import { completeJob } from '../util/job';
import { WorkItemStatus } from '../models/work-item-interface';

export interface WorkFailerConfig {
  logger: Logger;
}

/**
 * Fails the work items (and associated jobs) that are taking too long to complete.
 */
export default class WorkFailer implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkFailerConfig) {
    this.logger = config.logger;
  }

  /**
   * Find work items that're older than olderThanMinutes. Fail them and any associated jobs.
   * @param olderThanMinutes - upper limit on work item age
   * @param tx - the transaction to use for database interactions
   * @returns \{ failedWorkItemIds: number[], failedJobIds: string[] \}
   */
  async failWork(olderThanMinutes: number, tx: Transaction): Promise<{ failedWorkItemIds: number[], failedJobIds: string[] }> {
    let failedItems: {
      failedWorkItemIds: number[],
      failedJobIds: string[]
    };
    try {
      const workItems = await getWorkItemsByAgeAndStatus(
        tx, olderThanMinutes, [WorkItemStatus.RUNNING, WorkItemStatus.READY],
      );
      if (workItems.length) {
        const workItemIds = workItems.map((item) => item.id);
        await updateWorkItemStatuses(tx, workItemIds, WorkItemStatus.FAILED);
        const jobIds = new Set(workItems.map((item) => item.jobID));
        for (const jobId of jobIds) {
          const job = await Job.byJobID(tx, jobId, false, true);
          await completeJob(
            tx, job, JobStatus.FAILED, this.logger,
            `Job failed because one or more work items took too long (more than ${olderThanMinutes} minutes) to complete.`,
          );
        }
        failedItems = {
          failedJobIds: Array.from(jobIds.values()),
          failedWorkItemIds: workItemIds,
        };
        this.logger.info(`Work failer failed ${jobIds.size} jobs and ${workItems.length} work items.`);
      }
    } catch (e) {
      this.logger.error('Error attempting to fail long-running work items.');
      this.logger.error(e);
    }
    return failedItems;
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
        await db.transaction(async (tx) => {
          await this.failWork(
            env.failableWorkAgeMinutes,
            tx,
          );
        });
      } catch (e) {
        this.logger.error('Work failer failed to find work items to fail');
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
