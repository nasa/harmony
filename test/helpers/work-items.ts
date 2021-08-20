import { Application } from 'express';
import { afterEach, beforeEach } from 'mocha';
import WorkItem, { WorkItemRecord, WorkItemStatus } from 'models/work-item';
import request, { Test } from 'supertest';
import _ from 'lodash';
import db from '../../app/util/db';
import { truncateAll } from './db';
import { hookBackendRequest } from './hooks';
import { buildWorkflowStep, hookWorkflowStepCreationEach } from './workflow-steps';

export const exampleWorkItemProps = {
  jobID: '1',
  serviceID: 'harmony-services/query-cmr:latest',
  status: WorkItemStatus.READY,
  workflowStepIndex: 0,
} as WorkItemRecord;

/**
 *  Creates a work item with default values for fields that are not passed in
 *
 * @param fields - fields to use for the work item record
 * @returns a work item
 */
export function buildWorkItem(fields: Partial<WorkItemRecord> = {}): WorkItem {
  return new WorkItem({ ...exampleWorkItemProps, ...fields });
}

/**
 * Adds before / after hooks to create a work item with the given properties, saving it
 * to the DB, and storing it in `this.workItem`
 * @param props - properties to set on the work item
 * @param beforeFn - The mocha `before` function to use, i.e. `before` or `beforeEach`
 * @param afterFn - The mocha `after` function to use, i.e. `after` or `afterEach`
 */
export function hookWorkItemCreation(
  props: Partial<WorkItemRecord> = {},
  beforeFn = before,
  afterFn = after,
): void {
  beforeFn(async function () {
    this.workItem = buildWorkItem(props);
    await this.workItem.save(db);
  });

  afterFn(async function () {
    delete this.workItem;
    await truncateAll();
  });
}

/**
 * Adds beforeEach / afterEach hooks to create a work item with the given properties, saving it
 * to the DB, and storing it in `this.workItem`
 * @param props - properties to set on the work item
 */
export function hookWorkItemCreationEach(props: Partial<WorkItemRecord> = {}): void {
  hookWorkItemCreation(props, beforeEach, afterEach);
}

/**
 * Adds beforeEach / afterEach hooks to create a work item with the given properties, saving it
 * to the DB, and storing it in `this.workItem`
 * @param props - properties to set on the work item
 */
export function hookWorkflowStepAndItemCreationEach(props: object = {}): void {
  const workItem = buildWorkItem(_.pick(props, ['jobID', 'serviceID', 'status', 'workflowStepIndex', 'scrollID', 'stacCatalogLocation']));
  const workflowStep = buildWorkflowStep(_.pick(props, ['jobID', 'serviceID', 'stepIndex', 'workItemCount', 'operation']));

  workItem.jobID = workflowStep.jobID;
  workItem.serviceID = workflowStep.serviceID;
  workItem.workflowStepIndex = workflowStep.stepIndex;

  hookWorkflowStepCreationEach(workflowStep);
  hookWorkItemCreationEach(workItem);
}

/**
 * Adds a before hook to provide a work item update callback and await its processing
 *
 * @param fn - A function that takes a callback request and returns it augmented with any query
 *   params, post bodies, etc
 * @param finish - True if the hook should wait for the user request to finish
 * @param beforeFn - The mocha `before` function to use, i.e. `before` or `beforeEach`
 */
export function hookWorkItemUpdate(
  fn: (req: request.Test) => request.Test,
  finish = false,
  beforeFn = before,
): void {
  beforeFn(async function () {
    this.callbackRes = await fn(request(this.backend).put(`/service/work/${this.workItem.id}`).type('json'));
    if (finish) {
      this.userResp = await this.userPromise;
    }
  });
}

/**
 * Adds a beforeEach hook to provide a work item update callback and await its processing
 *
 * @param fn - A function that takes a callback request and returns it augmented with any query
 *   params, post bodies, etc
 * @param finish - True if the hook should wait for the user request to finish
 */
export function hookWorkItemUpdateEach(
  fn: (req: request.Test) => request.Test,
  finish = false,
): void {
  hookWorkItemUpdate(fn, finish, beforeEach);
}

/**
 * Performs getCoverageRangeset request on the given collection with the given params
 *
 * @param app - The express application (typically this.backend)
 * @param serviceID - The service polling for work
 * @returns The response
 */
export function getWorkForService(app: Application, serviceID: string): Test {
  return request(app).get('/service/work').query({ serviceID });
}

export const hookGetWorkForService = hookBackendRequest.bind(this, getWorkForService);
