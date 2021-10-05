import { Logger } from 'winston';
import { JobStatus, terminalStates } from '../models/job';
import { getWorkItemIdsByJobUpdateAgeAndStatus, deleteWorkItemsById } from '../models/work-item';
import { deleteWorkflowStepsById, getWorkflowStepIdsByJobUpdateAgeAndStatus } from '../models/workflow-steps';
import env from '../util/env';
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
    try {
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
    } catch (e) {
      this.logger.error('Error attempting to delete terminal work items');
      this.logger.error(e);
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    let firstRun = true;
    while (this.isRunning) {
      if (!firstRun) {
        await sleep(env.workReaperPeriodSec * 1000);
      }
      this.logger.info('Starting work reaper');
      try {
        await this.deleteTerminalWork(
          env.reapableWorkAgeMinutes,
          terminalStates,
        );
      } catch (e) {
        this.logger.error('Work reaper failed to delete terminal work');
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
