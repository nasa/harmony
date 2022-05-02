import { Application } from 'express';
import { afterEach, beforeEach } from 'mocha';
import path from 'path';
import { promises as fs } from 'fs';
import request, { Test } from 'supertest';
import _ from 'lodash';
import WorkItem from '../../app/models/work-item';
import db, { Transaction } from '../../app/util/db';
import env from '../../app/util/env';
import { truncateAll } from './db';
import { hookBackendRequest } from './hooks';
import { buildWorkflowStep, hookWorkflowStepCreation, hookWorkflowStepCreationEach } from './workflow-steps';
import { RecordConstructor } from '../../app/models/record';
import { WorkItemStatus, WorkItemRecord } from '../../app/models/work-item-interface';

export const exampleWorkItemProps = {
  jobID: '1',
  serviceID: 'harmony-services/query-cmr:latest',
  status: WorkItemStatus.READY,
  workflowStepIndex: 0,
} as WorkItemRecord;

/**
 * Create a partial WorkItemRecord from an array of data
 * @param data - The array of data containing the WorkItemRecord elements
 * @returns a record containing the supplied elements
 */
export function makePartialWorkItemRecord(data): Partial<WorkItemRecord> {
  return {
    jobID: data[0],
    serviceID: data[1],
    status: data[2],
    updatedAt: data[3],
    createdAt: data[3],
  };
}

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
 * Save a work item without validating or updating createdAt/updatedAt
 * @param tx - The transaction to use for saving the job
 * @param fields - The fields to save to the database, defaults to example values
 * @returns The saved work item
 * @throws Error - if the save to the database fails
 */
export async function rawSaveWorkItem(tx: Transaction, fields: Partial<WorkItemRecord> = {}): Promise<WorkItem> {
  const workItem = buildWorkItem(fields);
  let stmt = tx((workItem.constructor as RecordConstructor).table)
    .insert(workItem);
  if (db.client.config.client === 'pg') {
    stmt = stmt.returning('id'); // Postgres requires this to return the id of the inserted record
  }

  [workItem.id] = await stmt;

  return workItem;
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
 * Adds beforeEach / afterEach hooks to create a work item and workflow step
 * with the given properties, saving to the DB, and storing the item in `this.workItem`
 * and the step in `this.workflowStep`
 * @param props - properties to set on the work item and workflow step
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
 * Adds before / after hooks to create a work item and workflow step
 * with the given properties, saving to the DB, and storing the item in `this.workItem`
 * and the step in `this.workflowStep`
 * @param props - properties to set on the work item and workflow step
 */
export function hookWorkflowStepAndItemCreation(props: object = {}): void {
  const workItem = buildWorkItem(_.pick(props, ['jobID', 'serviceID', 'status', 'workflowStepIndex', 'scrollID', 'stacCatalogLocation']));
  const workflowStep = buildWorkflowStep(_.pick(props, ['jobID', 'serviceID', 'stepIndex', 'workItemCount', 'operation']));

  workItem.jobID = workflowStep.jobID;
  workItem.serviceID = workflowStep.serviceID;
  workItem.workflowStepIndex = workflowStep.stepIndex;

  hookWorkflowStepCreation(workflowStep);
  hookWorkItemCreation(workItem);
}

/**
 * Sends a request to update to a work item
 *
 * @param app - The express application (typically this.backend)
 * @param workItem - the updated WorkItem
 */
export function updateWorkItem(app: Application, workItem: WorkItem): Test {
  return request(app).put(`/service/work/${workItem.id}`).send(workItem);
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
 * Performs /service/work (get work for service) request for the given serviceID
 *
 * @param app - The express application (typically this.backend)
 * @param serviceID - The service polling for work
 * @returns The response
 */
export function getWorkForService(app: Application, serviceID: string): Test {
  return request(app).get('/service/work').query({ serviceID });
}

export const hookGetWorkForService = hookBackendRequest.bind(this, getWorkForService);

/**
 * Create fake output STAC catalogs/items to mock the execution of a service
 *
 * @param jobID - the job ID to which the STAC items belong
 * @param workItemID - the ID of the work item that generated the STAC items
 */
export async function fakeServiceStacOutput(jobID: string, workItemID: number, granuleCount = 1): Promise<void> {
  const outputDir = path.join(env.hostVolumePath, jobID, `${workItemID}`, 'outputs');
  await fs.mkdir(outputDir, { recursive: true });

  const exampleCatalog = {
    stac_version: '1.0.0-beta.2',
    stac_extensions: [],
    id: '748a4966-2bf7-4a8f-9bbe-d10b6ccc0efd',
    links: [
      {
        rel: 'harmony_source',
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1243729749-EEDTEST',
      },
      {
        rel: 'item',
        href: './granule.json',
        type: 'application/json',
        title: 'Fake Granule',
      },
    ],
    description: 'Fake STAC catalog',
  };

  // NOTE: this is not a valid STAC item because it is missing fields we don't need for our tests
  const exampleItem = {
    stac_version: '1.0.0-beta.2',
    stac_extensions: [],
    id: '63760c1d-0094-40f4-8344-319d8a7673cc',
    type: 'Feature',
    links: [],
    properties: {
      start_datetime: '2007-12-31T00:52:14.361Z',
      end_datetime: '2007-12-31T01:48:26.552Z',
    },
  };

  if (granuleCount > 1) {
    const catalogOfCatalogs = [];
    for (let i = 0; i < granuleCount; i++) {
      catalogOfCatalogs.push(`catalog${i}.json`);

      // create a fake STAC catalog
      exampleCatalog.links[1].href = `./granule${i}.json`;
      await fs.writeFile(path.join(outputDir, `catalog${i}.json`), JSON.stringify(exampleCatalog, null, 4));

      // create a fake STAC item
      await fs.writeFile(path.join(outputDir, `granule${i}.json`), JSON.stringify(exampleItem, null, 4));

    }

    // create fake catalog of catalogs
    await fs.writeFile(path.join(outputDir, 'batch-catalogs.json'), JSON.stringify(catalogOfCatalogs, null, 4));
  } else {
    // just write out a catalog and item

    // create a fake STAC catalog
    await fs.writeFile(path.join(outputDir, 'catalog.json'), JSON.stringify(exampleCatalog, null, 4));

    // create a fake STAC item
    await fs.writeFile(path.join(outputDir, 'granule.json'), JSON.stringify(exampleItem, null, 4));

  }
}