import { afterEach, beforeEach } from 'mocha';
import WorkflowStep, { WorkflowStepRecord } from '../../app/models/workflow-steps';
import db, { Transaction } from '../../app/util/db';
import { truncateAll } from './db';
import { parseSchemaFile } from './data-operation';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../../app/models/data-operation';
import { RecordConstructor } from '../../app/models/record';

export const validOperation = new DataOperation(parseSchemaFile('valid-operation-input.json')).serialize(CURRENT_SCHEMA_VERSION);

const exampleProps = {
  jobID: '1',
  serviceID: 'harmony-services/query-cmr:latest',
  stepIndex: 0,
  workItemCount: 10,
  operation: validOperation,
} as WorkflowStepRecord;

/**
 * Create a partial WorkFlowStepRecord from an array of data
 * @param data - The array of data containing the WorkItemRecord elements
 * @returns a record containing the supplied elements
 */
export function makePartialWorkflowStepRecord(data): Partial<WorkflowStepRecord> {
  return {
    jobID: data[0],
    serviceID: data[1],
    operation: data[2],
  };
}

/**
 *  Creates a workflow step with default values for fields that are not passed in
 *
 * @param fields - fields to use for the workflow step record
 * @returns a workflow step
 */
export function buildWorkflowStep(fields: Partial<WorkflowStepRecord> = {}): WorkflowStep {
  return new WorkflowStep({ ...exampleProps, ...fields });
}

/**
 * Save a workflow step using a partial record
 * @param tx - The transaction to use for saving the job
 * @param fields - The fields to save to the database, defaults to example values
 * @returns The saved workflow step
 * @throws Error - if the save to the database fails
 */
export async function rawSaveWorkflowStep(tx: Transaction, fields: Partial<WorkflowStepRecord> = {}): Promise<WorkflowStep> {
  const workflowStep = buildWorkflowStep(fields);
  workflowStep.createdAt = new Date();
  workflowStep.updatedAt = workflowStep.createdAt;
  let stmt = tx((workflowStep.constructor as RecordConstructor).table)
    .insert(workflowStep);
  if (db.client.config.client === 'pg') {
    stmt = stmt.returning('id'); // Postgres requires this to return the id of the inserted record
  }

  [workflowStep.id] = await stmt;

  return workflowStep;
}

/**
 * Adds before / after hooks to create a workflow step with the given properties, saving it
 * to the DB, and storing it in `this.workflowStep`
 * @param props - properties to set on the workflow step
 * @param beforeFn - The mocha `before` function to use, i.e. `before` or `beforeEach`
 * @param afterFn - The mocha `after` function to use, i.e. `after` or `afterEach`
 */
export function hookWorkflowStepCreation(
  props: Partial<WorkflowStepRecord> = {},
  beforeFn = before,
  afterFn = after,
): void {
  beforeFn(async function () {
    this.workflowStep = buildWorkflowStep(props);
    await this.workflowStep.save(db);
  });

  afterFn(async function () {
    delete this.workflowStep;
    await truncateAll();
  });
}

/**
 * Adds beforeEach / afterEach hooks to create a workflow step with the given properties, saving it
 * to the DB, and storing it in `this.workflowStep`
 * @param props - properties to set on the workflow step
 */
export function hookWorkflowStepCreationEach(props: Partial<WorkflowStepRecord> = {}): void {
  hookWorkflowStepCreation(props, beforeEach, afterEach);
}
