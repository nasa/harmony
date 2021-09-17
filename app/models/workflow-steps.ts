import { subMinutes } from 'date-fns';
import _ from 'lodash';
import { Transaction } from '../util/db';
import { Job, JobStatus } from './job';
import Record from './record';

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'serviceID', 'stepIndex',
  'workItemCount', 'operation', 'createdAt', 'updatedAt',
];

export interface WorkflowStepRecord {

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // the index of the step within the workflow
  stepIndex: number;

  // the total number of work items for this step
  workItemCount: number;

  // The operation to be performed by the service
  operation: string;
}

/**
 *
 * Wrapper object for persisted work items
 *
 */
export default class WorkflowStep extends Record implements WorkflowStepRecord {
  static table = 'workflow_steps';

  // The ID of the job that created this work item
  jobID: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  serviceID: string;

  // the index of the step within the workflow
  stepIndex: number;

  // the total number of work items for this step
  workItemCount: number;

  // The operation to be performed by the service as a string
  operation: string;
}

const tableFields = serializedFields.map((field) => `${WorkflowStep.table}.${field}`);

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
 * Returns all workflow steps for a job
 * @param tx - the transaction to use for querying
 * @param jobID - the job ID
 *
 * @returns A promise with the workflow steps array
 */
export async function getWorkflowStepsByJobId(
  tx: Transaction,
  jobID: string,
): Promise<WorkflowStep[]> {
  const workItemData = await tx(WorkflowStep.table)
    .select()
    .where({ jobID })
    .orderBy('id');

  return workItemData.map((i) => new WorkflowStep(i));
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

/**
 * Get all workflow step ids associated with jobs that haven't been updated for a
 * certain amount of minutes and that have a particular JobStatus
 * @param tx - the transaction to use for querying
 * @param notUpdatedForMinutes - jobs with updateAt older than notUpdatedForMinutes ago
 * will be joined with the returned workflow steps
 * @param jobStatus - only jobs with this status will be joined
 * @returns - all workflow step ids associated with the jobs that
 * met the updatedAt and status constraints
 */
export async function getWorkflowStepIdsByJobUpdateAgeAndStatus(
  tx: Transaction,
  notUpdatedForMinutes: number,
  jobStatus: JobStatus[],
): Promise<number[]> {
  const pastDate = subMinutes(new Date(), notUpdatedForMinutes);
  const workflowStepIds = (await tx(WorkflowStep.table)
    .innerJoin(Job.table, `${WorkflowStep.table}.jobID`, '=', `${Job.table}.jobID`)
    .select(...tableFields)
    .where(`${Job.table}.updatedAt`, '<', pastDate)
    .whereIn(`${Job.table}.status`, jobStatus))
    .map((step) => step.id);

  return workflowStepIds;
}

/**
 * Delete all workflow steps that have an id in the ids array.
 * @param tx - the transaction to use for querying
 * @param ids - the ids associated with workflow steps that will be deleted
 * @returns - the number of deleted workflow steps
 */
export async function deleteWorkflowStepsById(
  tx: Transaction,
  ids: number[],
): Promise<number> {
  const numDeleted = await tx(WorkflowStep.table)
    .whereIn('id', ids)
    .del();

  return numDeleted;
}
