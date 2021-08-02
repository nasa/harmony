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
 * @returns A promise with the work item or null if none
 */
export async function getWorkflowStepById(
  tx: Transaction,
  id: number,
): Promise<WorkflowStep> {
  const workflowStep = await tx(WorkflowStep.table)
    .select()
    .where({ id })
    .first();

  return new WorkflowStep(workflowStep);
}
