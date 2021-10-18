import { Logger } from 'winston';
import { WorkItemStatus, getWorkItemsByAgeAndStatus, updateWorkItemStatuses } from '../models/work-item';
import env from '../util/env';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';
import { Job, JobStatus } from 'app/models/job';
import { completeJob } from 'app/util/job';

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

  async failWork(olderThanMinutes: number): Promise<{ failedWorkItemIds: number[], failedJobIds: Set<string> }> {
    let failedCounts;
    try {
      await db.transaction(async (tx) => {
        const workItems = await getWorkItemsByAgeAndStatus(
          tx, olderThanMinutes, WorkItemStatus.RUNNING,
        );
        if (workItems.length) {
          const workItemIds = workItems.map((item) => item.id);
          await updateWorkItemStatuses(tx, workItemIds, WorkItemStatus.FAILED);
          const jobIds = new Set(workItems.map((item) => item.jobID));
          for (const jobId of jobIds) {
            const job = await Job.byJobID(tx, jobId);
            await completeJob(
              tx, job, JobStatus.FAILED, this.logger, 
              `Job failed because one or more work items took too long (more than ${olderThanMinutes} minutes) to complete.`,
            );
          }
          failedCounts = { failedJobIds: jobIds, failedWorkItemIds: workItemIds };
          this.logger.info(`Work failer failed ${jobIds.size} jobs and ${workItems.length} work items.`);
        }
      });
    } catch (e) {
      this.logger.error('Error attempting to fail long-running work items.');
      this.logger.error(e);
      return;
    } finally {
      return failedCounts;
    }
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
        await this.failWork(
          env.failableWorkAgeMinutes,
        );
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
