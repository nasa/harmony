import { afterEach, beforeEach } from 'mocha';
import WorkItem, { WorkItemRecord, WorkItemStatus } from 'models/work-item';
import db from '../../app/util/db';
import { truncateAll } from './db';

const exampleProps = {
  jobID: '1',
  serviceID: 'harmony-services/query-cmr:latest',
  status: WorkItemStatus.READY,
  workflowStepIndex: 0,
} as WorkItemRecord;

/**
 *  Creates a work item with default values for fields that are not passed in
 *
 * @param fields - feilds to use for the work item record
 * @returns a work item
 */
export function buildWorkItem(fields: Partial<WorkItemRecord> = {}): WorkItem {
  return new WorkItem({ ...exampleProps, ...fields });
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
    this.workItem.save(db);
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
