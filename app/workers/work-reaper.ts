import { Logger } from 'winston';
import _ from 'lodash';
import { JobStatus, terminalStates } from '../models/job';
import { getWorkItemIdsByJobUpdateAgeAndStatus, deleteWorkItemsById } from '../models/work-item';
import { getWorkflowStepIdsByJobUpdateAgeAndStatus, deleteWorkflowStepsById } from '../models/workflow-steps';
import { env } from '@harmony/util';
import { Worker } from './worker';
import db from '../util/db';
import sleep from '../util/sleep';

export interface WorkReaperConfig {
  logger: Logger;
}

/**
 * Delete the work items and workflow steps associated with terminal jobs
 * that haven't been updated for a configurable amount of minutes.
 */
export default class WorkReaper implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkReaperConfig) {
    this.logger = config.logger;
  }


  /**
   * Find work items that are older than notUpdatedForMinutes and delete them.
   * @param notUpdatedForMinutes - upper limit on the duration since the last update
   * @param jobStatus - a list of terminal job statuses
   * @returns Resolves when the request is complete
   */
  async deleteTerminalWorkItems(notUpdatedForMinutes: number, jobStatus: JobStatus[]): Promise<void> {
    let done = false;
    let startingId = 0;
    let totalDeleted = 0;
    const batchSize = env.workReaperBatchSize;
    this.logger.info('Work reaper delete terminal work items started.');

    while (!done) {
      try {
        const workItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
          db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
        );
        if (workItemIds.length > 0) {
          const numItemsDeleted = await deleteWorkItemsById(db, workItemIds);
          totalDeleted += numItemsDeleted;
          this.logger.info(`Work reaper removed ${numItemsDeleted} work items, starting id: ${startingId}.`);
          startingId = workItemIds[workItemIds.length - 1];
        } else {
          this.logger.info('Work reaper did not find any work items to delete');
        }

        if (workItemIds.length < batchSize) {
          done = true;
        }
      } catch (e) {
        done = true;
        this.logger.error('Error attempting to delete terminal work items');
        this.logger.error(e);
      }
    }
    this.logger.info(`Work reaper delete terminal work items completed. Total work items deleted: ${totalDeleted}`);
  }

  /**
   * Find workflow steps that are older than notUpdatedForMinutes and delete them.
   * @param notUpdatedForMinutes - upper limit on the duration since the last update
   * @param jobStatus - a list of terminal job statuses
   * @returns Resolves when the request is complete
   */
  async deleteTerminalWorkflowSteps(notUpdatedForMinutes: number, jobStatus: JobStatus[]): Promise<void> {
    let done = false;
    let startingId = 0;
    let totalDeleted = 0;
    const batchSize = env.workReaperBatchSize;
    this.logger.info('Work reaper delete terminal workflow steps started.');

    while (!done) {
      try {
        const workflowSteps = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
          db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
        );
        if (workflowSteps.length > 0) {
          const numItemsDeleted = await deleteWorkflowStepsById(db, workflowSteps);
          totalDeleted += numItemsDeleted;
          this.logger.info(`Work reaper removed ${numItemsDeleted} workflow steps, starting id: ${startingId}.`);
          startingId = workflowSteps[workflowSteps.length - 1];
        } else {
          this.logger.info('Work reaper did not find any workflow steps to delete');
        }

        if (workflowSteps.length < batchSize) {
          done = true;
        }
      } catch (e) {
        done = true;
        this.logger.error('Error attempting to delete terminal workflow steps');
        this.logger.error(e);
      }
    }
    this.logger.info(`Work reaper delete terminal workflow steps completed. Total workflow steps deleted: ${totalDeleted}`);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    let firstRun = true;
    this.logger.info('Starting work reaper');
    while (this.isRunning) {
      if (!firstRun) {
        await sleep(env.workReaperPeriodSec * 1000);
      }
      try {
        await this.deleteTerminalWorkItems(
          env.reapableWorkAgeMinutes,
          terminalStates,
        );
        await this.deleteTerminalWorkflowSteps(
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
