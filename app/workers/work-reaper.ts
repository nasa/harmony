import { JobStatus } from 'models/job';
import { Logger } from 'winston';
import { getWorkItemIdsByJobUpdateAgeAndStatus, deleteWorkItemsById } from 'models/work-item';
import { deleteWorkflowStepsById, getWorkflowStepIdsByJobUpdateAgeAndStatus } from 'models/workflow-steps';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';

export interface WorkReaperConfig {

  logger: Logger;

}

export default class WorkReaper implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkReaperConfig) {
    this.logger = config.logger;
  }

  async deleteTerminalWork(notUpdatedForMinutes: number, jobStatus: JobStatus[]): Promise<void> {
    const workItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
      db, notUpdatedForMinutes, jobStatus,
    );
    if (workItemIds.length) {
      const numItemsDeleted = await deleteWorkItemsById(db, workItemIds);
      this.logger.info(`Work reaper removed ${numItemsDeleted} work items`);
    } else {
      this.logger.info('Work reaper did not find any work items to delete');
    }
    const workStepIds = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
      db, notUpdatedForMinutes, jobStatus,
    );
    if (workStepIds.length) {
      const numStepsDeleted = await deleteWorkflowStepsById(db, workStepIds);
      this.logger.info(`Work reaper removed ${numStepsDeleted} workflow steps`);
    } else {
      this.logger.info('Work reaper did not find any workflow steps to delete');
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    while (this.isRunning) {
      this.logger.info('Starting work reaper');
      try {
        await this.deleteTerminalWork(
          60 * 24, // 24 hrs
          [
            JobStatus.FAILED,
            JobStatus.SUCCESSFUL,
            JobStatus.CANCELED,
          ],
        );
        await sleep(60 * 60 * 1000); // 1 hr
      } catch (e) {
        this.logger.error('Error while removing old work steps and items');
        this.logger.error(e);
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}
