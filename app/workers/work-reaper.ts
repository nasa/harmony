import { JobStatus } from 'models/job';
import { Logger } from 'winston';
import { getWorkItemsByJobUpdateAgeAndStatus, deleteWorkItemsById } from 'models/work-item';
import { deleteWorkflowStepsById, getWorkflowStepsByJobUpdateAgeAndStatus } from 'models/workflow-steps';
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
    const workItems = await getWorkItemsByJobUpdateAgeAndStatus(
      db, notUpdatedForMinutes, jobStatus,
    );
    const workItemIds = workItems.map((i) => i.id);
    const numItemsDeleted = await deleteWorkItemsById(db, workItemIds);
    this.logger.info(`Work reaper removed ${numItemsDeleted} work items`);

    const workSteps = await getWorkflowStepsByJobUpdateAgeAndStatus(
      db, notUpdatedForMinutes, jobStatus,
    );
    const workStepIds = workSteps.map((i) => i.id);
    const numStepsDeleted = await deleteWorkflowStepsById(db, workStepIds);
    this.logger.info(`Work reaper removed ${numStepsDeleted} workflow steps`);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    while (this.isRunning) {
      this.logger.info('Starting work reaper');
      try {
        await this.deleteTerminalWork(
          60 * 1,
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
