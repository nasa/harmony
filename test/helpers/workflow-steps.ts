import { afterEach, beforeEach } from 'mocha';
import WorkflowStep, { WorkflowStepRecord } from 'models/workflow-steps';
import db from '../../app/util/db';
import { truncateAll } from './db';

const exampleProps = {
  jobID: '1',
  serviceID: 'harmony-services/query-cmr:latest',
  stepIndex: 0,
  workItemCount: 10,
} as WorkflowStepRecord;

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
