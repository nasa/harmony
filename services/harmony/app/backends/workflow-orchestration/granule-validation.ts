import { Logger } from 'winston';

import { Job, JobStatus } from '../../models/job';
import { incrementReadyAndDecrementRunningCounts } from '../../models/user-work';
import { getWorkItemById } from '../../models/work-item';
import { WorkItemStatus } from '../../models/work-item-interface';
import WorkItemUpdate from '../../models/work-item-update';
import { getWorkflowStepByJobIdStepIndex } from '../../models/workflow-steps';
import db from '../../util/db';
import { completeJob } from '../../util/job';
import { logAsyncExecutionTime } from '../../util/log-execution';

/**
 * Process a granule validation work item update
 *
 * @param jobId - job id
 * @param update - the work item update
 * @param logger - the Logger for the request
 */
export async function handleGranuleValidation(
  jobID: string,
  update: WorkItemUpdate,
  logger: Logger): Promise<void> {
  const { workItemID, status, message } = update;
  try {
    const transactionStart = new Date().getTime();

    await db.transaction(async (tx) => {
      const { job } = await (await logAsyncExecutionTime(
        Job.byJobID,
        'HWIUWJI.Job.byJobID',
        logger))(tx, jobID, false, false, true);

      if (status === WorkItemStatus.FAILED) {
        // update job status and message
        await completeJob(tx, job, JobStatus.FAILED, logger, message);
      } else {
        // update workflowstep operation
        const thisWorkflowStep = await (await logAsyncExecutionTime(
          getWorkflowStepByJobIdStepIndex,
          'HWIUWJI.getWorkflowStepByJobIdStepIndex',
          logger))(db, jobID, update.workflowStepIndex);
        const op = JSON.parse(thisWorkflowStep.operation);
        delete op.extraArgs;
        thisWorkflowStep.operation = JSON.stringify(op);
        await thisWorkflowStep.save(tx);

        let needSave = false;
        if (update.hits && job.numInputGranules > update.hits) {
          job.numInputGranules = update.hits;
          needSave = true;
        }

        if (message) {
          // update job message for running and successful status
          job.message = message;
          job.setMessage(message, JobStatus.SUCCESSFUL);
          needSave = true;
        }

        if (needSave) {
          await job.save(tx);
        }

        // mark the work item as ready to be processed without granule validation
        const workItem = await (await logAsyncExecutionTime(
          getWorkItemById,
          'HWIUWJI.getWorkItemById',
          logger))(tx, workItemID, true);

        logger.info(`Granule validation is successful, continue processing work-item ${workItemID}`);
        workItem.status = WorkItemStatus.READY;
        await workItem.save(tx);

        await (await logAsyncExecutionTime(
          incrementReadyAndDecrementRunningCounts,
          'HWIUWJI.incrementReadyAndDecrementRunningCounts',
          logger))(tx, jobID, workItem.serviceID);
      }
    });
    const durationMs = new Date().getTime() - transactionStart;
    logger.info('timing.HWIUWJI.handleGranValidation.end', { durationMs });
  } catch (e) {
    logger.error('Unable to acquire lock on Jobs table');
    logger.error(e);
  }
}