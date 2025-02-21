import { JobStatus, terminalStates } from '../../../harmony/app/models/job';
import {
  deleteWorkItemsById, getWorkItemIdsByJobUpdateAgeAndStatus,
} from '../../../harmony/app/models/work-item';
import {
  deleteWorkflowStepsById, getWorkflowStepIdsByJobUpdateAgeAndStatus,
} from '../../../harmony/app/models/workflow-steps';
import { Context } from '../util/context';
import env from '../util/env';
import { CronJob } from './cronjob';

/**
 * Find work items that are older than notUpdatedForMinutes and delete them.
 * @param notUpdatedForMinutes - upper limit on the duration since the last update
 * @param jobStatus - a list of terminal job statuses
 * @returns Resolves when the request is complete
 */
async function deleteTerminalWorkItems(ctx: Context, notUpdatedForMinutes: number, jobStatus: JobStatus[]): Promise < void> {
  let done = false;
  let startingId = 0;
  let totalDeleted = 0;
  const batchSize = env.workReaperBatchSize;
  const { logger, db } = ctx;
  logger.info('Work reaper delete terminal work items started.');

  while (!done) {
    try {
      const workItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
        db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
      );
      if (workItemIds.length > 0) {
        const numItemsDeleted = await deleteWorkItemsById(db, workItemIds);
        totalDeleted += numItemsDeleted;
        logger.info(`Work reaper removed ${numItemsDeleted} work items, starting id: ${startingId}.`);
        startingId = workItemIds[workItemIds.length - 1];
      } else {
        logger.info('Work reaper did not find any work items to delete');
      }

      if (workItemIds.length < batchSize) {
        done = true;
      }
    } catch (e) {
      done = true;
      logger.error('Error attempting to delete terminal work items');
      logger.error(e);
    }
  }
  logger.info(`Work reaper delete terminal work items completed. Total work items deleted: ${totalDeleted}`);
}


/**
 * Find workflow steps that are older than notUpdatedForMinutes and delete them.
 * @param notUpdatedForMinutes - upper limit on the duration since the last update
 * @param jobStatus - a list of terminal job statuses
 * @returns Resolves when the request is complete
 */
async function deleteTerminalWorkflowSteps(ctx: Context, notUpdatedForMinutes: number, jobStatus: JobStatus[]): Promise < void> {
  let done = false;
  let startingId = 0;
  let totalDeleted = 0;
  const batchSize = env.workReaperBatchSize;
  const { logger, db } = ctx;
  logger.info('Work reaper delete terminal workflow steps started.');

  while (!done) {
    try {
      const workflowSteps = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
        db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
      );
      if (workflowSteps.length > 0) {
        const numItemsDeleted = await deleteWorkflowStepsById(db, workflowSteps);
        totalDeleted += numItemsDeleted;
        logger.info(`Work reaper removed ${numItemsDeleted} workflow steps, starting id: ${startingId}.`);
        startingId = workflowSteps[workflowSteps.length - 1];
      } else {
        logger.info('Work reaper did not find any workflow steps to delete');
      }

      if (workflowSteps.length < batchSize) {
        done = true;
      }
    } catch (e) {
      done = true;
      logger.error('Error attempting to delete terminal workflow steps');
      logger.error(e);
    }
  }
  logger.info(`Work reaper delete terminal workflow steps completed. Total workflow steps deleted: ${totalDeleted}`);
}

/**
 * Work reaper class for cron service
 */
export class WorkReaper extends CronJob {

  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.debug('Running');
    try {
      await deleteTerminalWorkItems(
        ctx,
        env.reapableWorkAgeMinutes,
        terminalStates,
      );
      await deleteTerminalWorkflowSteps(
        ctx,
        env.reapableWorkAgeMinutes,
        terminalStates,
      );
    } catch (e) {
      logger.error('Work reaper failed to delete terminal work');
      logger.error(e);
    }
  }
}