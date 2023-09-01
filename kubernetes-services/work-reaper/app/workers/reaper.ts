import _ from 'lodash';
import { JobStatus, terminalStates } from '../../../../app/models/job';
import { getWorkItemIdsByJobUpdateAgeAndStatus, deleteWorkItemsById } from '../../../../app/models/work-item';
import { getWorkflowStepIdsByJobUpdateAgeAndStatus, deleteWorkflowStepsById } from '../../../../app/models/workflow-steps';
import db from '../../../../app/util/db';
import log from '../../../../app/util/log';
import sleep from '../../../../app/util/sleep';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';



export default class Reaper implements Worker {

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
    log.info('Work reaper delete terminal work items started.');

    while (!done) {
      try {
        console.log(`DB: ${JSON.stringify(db, null, 2)}`);
        const workItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
          db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
        );
        if (workItemIds.length > 0) {
          const numItemsDeleted = await deleteWorkItemsById(db, workItemIds);
          totalDeleted += numItemsDeleted;
          log.info(`Work reaper removed ${numItemsDeleted} work items, starting id: ${startingId}.`);
          startingId = workItemIds[workItemIds.length - 1];
        } else {
          log.info('Work reaper did not find any work items to delete');
        }

        if (workItemIds.length < batchSize) {
          done = true;
        }
      } catch (e) {
        done = true;
        log.error('Error attempting to delete terminal work items');
        log.error(e);
      }
    }
    log.info(`Work reaper delete terminal work items completed. Total work items deleted: ${totalDeleted}`);
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
    log.info('Work reaper delete terminal workflow steps started.');

    while (!done) {
      try {
        const workflowSteps = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
          db, notUpdatedForMinutes, jobStatus, startingId, batchSize,
        );
        if (workflowSteps.length > 0) {
          const numItemsDeleted = await deleteWorkflowStepsById(db, workflowSteps);
          totalDeleted += numItemsDeleted;
          log.info(`Work reaper removed ${numItemsDeleted} workflow steps, starting id: ${startingId}.`);
          startingId = workflowSteps[workflowSteps.length - 1];
        } else {
          log.info('Work reaper did not find any workflow steps to delete');
        }

        if (workflowSteps.length < batchSize) {
          done = true;
        }
      } catch (e) {
        done = true;
        log.error('Error attempting to delete terminal workflow steps');
        log.error(e);
      }
    }
    log.info(`Work reaper delete terminal workflow steps completed. Total workflow steps deleted: ${totalDeleted}`);
  }

  
async start(): Promise<void> {
    let firstRun = true;
    log.info('Starting work reaper');
    while (true) {
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
        log.error('Work reaper failed to delete terminal work');
        log.error(e);
      } finally {
        firstRun = false;
      }
    }
  }
}
