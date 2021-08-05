import _ from 'lodash';
import { Transaction } from '../util/db';
import DataOperation from './data-operation';
import Record from './record';

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkflowStep extends Record {
  static table = 'workflow_steps';

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // the index of the step within the workflow
  stepIndex: number;

  // the total number of work items for this step
  workItemCount: number;

  // The operation to be performed by the service
  operation: DataOperation;
}

/**
 * Returns the workflow step by the ID
 * @param tx - the transaction to use for querying
 * @param id - the work item ID
 *
 * @returns A promise with the workflow step or null if none
 */
export async function getWorkflowStepById(
  tx: Transaction,
  id: number,
): Promise<WorkflowStep | null> {
  const workflowStepData = await tx(WorkflowStep.table)
    .select()
    .where({ id })
    .first();

  return workflowStepData && new WorkflowStep(workflowStepData);
}

/**
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the Job for the step
 * @param stepIndex - the index of the step within the workflow
 * @returns A promise with the workflow step or null if none
 */
export async function getWorkflowStepByJobIdStepIndex(
  tx: Transaction,
  jobID: string,
  stepIndex: number,
): Promise<WorkflowStep | null> {
  const workflowStepData = await tx(WorkflowStep.table)
    .select()
    .where({ jobID, stepIndex })
    .first();

  return workflowStepData && new WorkflowStep(workflowStepData);
}
