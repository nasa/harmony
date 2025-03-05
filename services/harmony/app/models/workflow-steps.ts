/* eslint-disable @typescript-eslint/dot-notation */
import env from '../util/env';
import _ from 'lodash';
import { Transaction } from '../util/db';
import { Job, JobStatus } from './job';
import Record from './record';
import WorkItem, { workItemCountForStep } from './work-item';
import { COMPLETED_WORK_ITEM_STATUSES } from './work-item-interface';

// The fields to save to the database
const serializedFields = [
  'id', 'jobID', 'serviceID', 'stepIndex',
  'workItemCount', 'operation', 'createdAt', 'updatedAt',
  'hasAggregatedOutput', 'isBatched', 'is_sequential', 'is_complete', 'maxBatchInputs',
  'maxBatchSizeInBytes', 'completed_work_item_count', 'progress_weight',
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

  // Whether or not this step aggregates the outputs of a previous step
  hasAggregatedOutput: boolean;

  // Whether or not the service should receive a batch of inputs
  isBatched: boolean;

  // Whether or not the service is executed in parallel (the default) or sequentially, like
  // query-cmr
  is_sequential: boolean;

  // Whether or not the step has been completed
  is_complete: boolean;

  // The maximum number of input granules in each invocation of the service
  maxBatchInputs: number;

  // The upper limit on the combined sizes of all the files in a batch
  maxBatchSizeInBytes: number;

  // The number of work-items that have been completed (successfully or otherwise)
  completed_work_item_count: number;

  // What percentage of the work for this step has been completed
  progress: number;

  // Relative contribution of this step to the overall job progress calculation
  progress_weight: number;
}

/**
 *
 * Wrapper object for persisted workflow steps
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

  // Whether or not this step aggregates the outputs of a previous step
  hasAggregatedOutput: boolean;

  // Whether or not the service should receive a batch of inputs
  isBatched: boolean;

  // Whether or not the service is executed in parallel (the default) or sequentially, like
  // query-cmr
  is_sequential: boolean;

  // Whether or not the step has been completed
  is_complete: boolean;

  // The maximum number of input granules in each invocation of the service
  maxBatchInputs: number;

  // The upper limit on the combined sizes of all the files in a batch
  maxBatchSizeInBytes: number;

  // The number of work-items that have been completed (successfully or otherwise)
  completed_work_item_count: number;

  // What percentage of the work for this step has been completed
  progress: number;

  // Relative contribution of this step to the overall job progress calculation
  progress_weight: number;

  /**
 * Get the collections that are the sources for the given operation
 *
 * @returns an array of strings containing the collections for the operation
 */
  collectionsForOperation(): string[] {
    const op = JSON.parse(this.operation);
    return op.sources.map(source => source.collection);
  }

  /**
   * Update the progress value based on the number of completed work-items for this step.
   * NOTE: this should be called on the workflow steps in order since the progress
   * computation depends on the progress of the previous step.
   *
   * @param prevStep - the previous step in the workflow (nil if this is the first step)
   * @returns an integer number representing the percent progress
   */
  updateProgress(prevStep: WorkflowStep): number {
    let workItemCount = Math.max(1, this.workItemCount);
    const completedItemCount = Math.max(0, this.completed_work_item_count);
    workItemCount = Math.max(workItemCount, completedItemCount);
    let prevProgress = 1.0;
    if (prevStep) {
      prevProgress = Math.max(0, prevStep.progress) / 100.0;
    }
    this.progress = Math.floor(100.0 * prevProgress * completedItemCount / workItemCount);
    return this.progress;
  }

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
 * @param fields - optional table fields to include in the result - default is all
 * @returns A promise with the workflow steps array
 */
export async function getWorkflowStepsByJobId(
  tx: Transaction,
  jobID: string,
  fields = tableFields,
): Promise<WorkflowStep[]> {
  const workItemData = await tx(WorkflowStep.table)
    .select(...fields)
    .where({ jobID })
    .orderBy('id');

  return workItemData.map((i) => new WorkflowStep(i));
}

/**
 * Returns the workflow step for the given Job ID and step index
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
 * Returns the workflow step for the given Job ID and service ID
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the ID of the Job for the step
 * @param serviceID - the serviceID of the step within the workflow
 * @param fields - optional table fields to include in the result - default is all
 * @returns A promise with the workflow step or null if none
 */
export async function getWorkflowStepByJobIdServiceId(
  tx: Transaction,
  jobID: string,
  serviceID: string,
  fields = tableFields,
): Promise<WorkflowStep | null> {
  const workflowStepData = await tx(WorkflowStep.table)
    .select(...fields)
    .where({ jobID, serviceID })
    .first();

  return workflowStepData && new WorkflowStep(workflowStepData);
}

/**
 * Get all workflow step ids associated with jobs that haven't been updated for a
 * certain amount of minutes and that have a particular JobStatus
 * @param tx - the transaction to use for querying
 * @param updatedAtCutoff - jobs with updatedAt older than updatedAtCutoff will be
 * joined with the returned workflow steps
 * @param jobStatus - only jobs with this status will be joined
 * @param startingId - the workflow step id to begin the query with, i.e. query workflow steps
 * with id greater than startingId
 * @param batchSize - the batch size
 * @returns - all workflow step ids associated with the jobs that met the updatedAt and status
 *            constraints
 */
export async function getWorkflowStepIdsByJobUpdateAgeAndStatus(
  tx: Transaction,
  updatedAtCutoff: Date,
  jobStatus: JobStatus[],
  startingId = 0,
  batchSize = 2000,
): Promise<number[]> {
  const workflowStepIds = (await tx(WorkflowStep.table)
    .innerJoin(Job.table, `${WorkflowStep.table}.jobID`, '=', `${Job.table}.jobID`)
    .select([`${WorkflowStep.table}.id`])
    .where(`${Job.table}.updatedAt`, '<', updatedAtCutoff)
    .whereIn(`${Job.table}.status`, jobStatus)
    .where(`${WorkflowStep.table}.id`, '>', startingId)
    .orderBy(`${WorkflowStep.table}.id`, 'asc')
    .limit(batchSize))
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

/**
 * Decrements the number of expected work items for all future steps. Used when
 * a work item fails.
 *
 * @param tx - the database transaction
 * @param jobID - the job ID
 * @param stepIndex - the current step index
 */
export async function decrementFutureWorkItemCount(tx: Transaction, jobID, stepIndex): Promise<void> {
  await tx(WorkflowStep.table)
    .where({ jobID })
    .andWhere('stepIndex', '>', stepIndex)
    .andWhere('hasAggregatedOutput', false)
    .decrement('workItemCount');
}

/**
 * Decrement the number of expected work items for the step. Used during batching when prior step
 * items fail and we end up with the final batch being empty.
 *
 * @param tx - the database transaction
 * @param jobID - the job ID
 * @param stepIndex - the current step index
 */
export async function decrementWorkItemCount(tx: Transaction, jobID, stepIndex): Promise<void> {
  await tx(WorkflowStep.table)
    .where({ jobID, stepIndex })
    .decrement('workItemCount');
}

/**
 * Determine whether or not the workflow step is complete and set its `is_complete` column
 * to `true` if so.
 *
 * @param tx - the database transaction
 * @param jobID - the job ID
 * @param step - the current workflow step
 * @returns a Promise containing a boolean that indicates whether or not the step is complete
 */
export async function updateIsComplete(tx: Transaction, jobID: string, numInputGranules: number, step: WorkflowStep): Promise<boolean> {

  let isComplete = false;

  const { stepIndex } = step;

  if (step.is_sequential) {
    const completedCount = await workItemCountForStep(tx, jobID, stepIndex, COMPLETED_WORK_ITEM_STATUSES);
    // TODO this is only true for query-cmr. If we add another sequential service we need to
    // fix this.
    const expectedCount = Math.ceil(numInputGranules / env.cmrMaxPageSize);
    isComplete = completedCount == expectedCount;

  } else {
    let prevStepComplete = true;
    if (stepIndex > 1) {
      const prevStepCompleteResult = await tx(WorkflowStep.table)
        .first('is_complete')
        .where({ jobID, stepIndex: stepIndex - 1 });
      prevStepComplete = prevStepCompleteResult['is_complete'];
    }

    if (prevStepComplete) {
      const isNotCompleteResult = await tx
        .select(tx.raw('EXISTS ? AS not_complete',
          tx(WorkItem.table)
            .select(tx.raw('1'))
            .where({ jobID, workflowStepIndex: stepIndex })
            .andWhere('status', 'not in', COMPLETED_WORK_ITEM_STATUSES)),
        );

      isComplete = !isNotCompleteResult[0]['not_complete'];
    }
  }

  if (isComplete) {
    await tx(WorkflowStep.table)
      .where({ jobID, stepIndex })
      .update('is_complete', true);
  }

  return isComplete;
}
