import { expect } from 'chai';
import _ from 'lodash';
import { spy } from 'sinon';
import db from '../app/util/db';
import hookServersStartStop from './helpers/servers';
import { buildWorkItem, fakeServiceStacOutput, getWorkForService, updateWorkItem } from './helpers/work-items';
import { buildWorkflowStep, validOperationWithManyVariables } from './helpers/workflow-steps';
import { buildJob } from './helpers/jobs';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';
import { populateUserWorkFromWorkItems } from '../app/models/user-work';
import { MemoryCache } from '../app/util/cache/memory-cache';

/**
 * Create a job with many variables and some work steps/items to be used by tests
 *
 * @param nonAggregateService - identifier for a service that does not aggregate
 * @param service - identifier for a service
 * @returns a promise containing the id of the created job
 */
async function createJobAndWorkItemsWithManyVariables(
  service: string): Promise<string> {
  await truncateAll();
  const job = buildJob({ numInputGranules: 1 });
  await job.save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID: 'harmonyservices/query-cmr:latest',
    stepIndex: 1,
    is_sequential: true,
    workItemCount: 1,
  }).save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID: service,
    stepIndex: 2,
    workItemCount: 0,
    hasAggregatedOutput: false,
    operation: validOperationWithManyVariables,
  }).save(db);

  await buildWorkItem({
    jobID: job.jobID,
    serviceID: 'harmonyservices/query-cmr:latest',
    workflowStepIndex: 1,
  }).save(db);

  await populateUserWorkFromWorkItems(db);
  return job.jobID;
}

describe('When a request contains many variables', async function () {
  let fetchSpy;
  before(function () {
    fetchSpy = spy(MemoryCache.prototype, 'fetch');
  });

  after(function () {
    fetchSpy.restore();
  });
  hookServersStartStop();
  before(async function () {
    await truncateAll();
    this.jobID = await createJobAndWorkItemsWithManyVariables('foo');

  });

  it('includes all the variables in the data operation', async function () {
    const queryCmrRes = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
    const queryCmrWorkItem = JSON.parse(queryCmrRes.text).workItem;
    queryCmrWorkItem.status = WorkItemStatus.SUCCESSFUL;
    queryCmrWorkItem.results = [getStacLocation(queryCmrWorkItem, 'catalog.json')];
    queryCmrWorkItem.outputItemSizes = [1];
    await fakeServiceStacOutput(queryCmrWorkItem.jobID, queryCmrWorkItem.id, 1);
    await updateWorkItem(this.backend, queryCmrWorkItem);
    const res = await getWorkForService(this.backend, 'foo');
    const { workItem } = JSON.parse(res.text);
    const { variables } = workItem.operation.sources[0];
    expect(variables.length).to.equal(10000);

  });

  it('uses the cache to pass the data operation', async function () {
    // called once for query-cmr and once for the foo service
    expect(fetchSpy.calledTwice).to.equal(true);
    // uses the job ID and service name for cache key (comma separated)
    expect(fetchSpy.args[1][0]).to.equal(`${this.jobID},foo`);
    const operationFromCache = await fetchSpy.returnValues[1];
    expect(operationFromCache).to.equal(validOperationWithManyVariables);
  });
});