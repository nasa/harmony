import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { getWorkItemById, getWorkItemsByJobId, getWorkItemsByJobIdAndStepIndex } from '../app/models/work-item';
import { getWorkflowStepByJobIdStepIndex, getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import db from '../app/util/db';
import env from '../app/util/env';
import { Job, JobStatus } from '../app/models/job';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import { buildWorkItem, getWorkForService, hookGetWorkForService, updateWorkItem, fakeServiceStacOutput } from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';
import * as aggregationBatch from '../app/util/aggregation-batch';
import { buildJob, getFirstJob } from './helpers/jobs';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';
import { stub } from 'sinon';
import { populateUserWorkFromWorkItems } from '../app/models/user-work';
import { resetQueues } from './helpers/queue';

/**
 * Create a job and some work steps/items to be used by tests
 *
 * @param initialCmrHits - The number of hits returned by the CMR the first time it is queries
 * @param initialQueryCmrWorkItemCount - The number of query-cmr work items anticipated by the
 * initial number of cmr hits
 * @param nonAggregateService - identifier for a service that does not aggregate
 * @param aggregateService - identifier for a service that does aggregate
 * @returns a promise containing the id of the created job
 */
async function createJobAndWorkItems(
  initialCmrHits: number,
  initialQueryCmrWorkItemCount: number,
  nonAggregateService: string,
  aggregateService: string): Promise<string> {
  await truncateAll();
  const job = buildJob({ numInputGranules: initialCmrHits });
  await job.save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID: 'harmonyservices/query-cmr:stable',
    stepIndex: 1,
    is_sequential: true,
    workItemCount: initialQueryCmrWorkItemCount,
  }).save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID: nonAggregateService,
    stepIndex: 2,
    workItemCount: 0,
    hasAggregatedOutput: false,
  }).save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID: aggregateService,
    stepIndex: 3,
    workItemCount: 0,
    hasAggregatedOutput: true,
  }).save(db);

  await buildWorkItem({
    jobID: job.jobID,
    serviceID: 'harmonyservices/query-cmr:stable',
    workflowStepIndex: 1,
  }).save(db);

  await populateUserWorkFromWorkItems(db);
  return job.jobID;
}

/**
 * Defines tests that ensure that the initial conditions for a job are correct
 *
 * @param initialCmrHits - The number of hits returned by the CMR the first time it is queries
 * @param initialQueryCmrWorkItemCount - The number of query-cmr work items anticipated by the
 * initial number of cmr hits
 */
async function testInitialConditions(initialCmrHits: number, initialQueryCmrWorkItemCount: number): Promise<void> {
  it('sets the initial numInputGranules on the job', async function () {
    const { job } = await Job.byJobID(db, this.jobID);
    expect(job.numInputGranules).equals(initialCmrHits);
  });
  it('sets the initial number of work items for each step', async function () {
    const workflowSteps = await getWorkflowStepsByJobId(db, this.jobID);
    expect(workflowSteps[0].workItemCount).equals(initialQueryCmrWorkItemCount);
    expect(workflowSteps[1].workItemCount).equals(0);
    expect(workflowSteps[2].workItemCount).equals(0);
  });
}

describe('when a work item callback request does not return the results to construct the next work item(s)', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();
  const reprojectAndZarrQuery = {
    maxResults: 2,
    outputCrs: 'EPSG:4326',
    interpolation: 'near',
    scaleExtent: '0,2500000.3,1500000,3300000',
    scaleSize: '1.1,2',
    format: 'application/x-zarr',
    concatenate: false, // Aggregated workflows are tested below
  };

  hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
  hookRedirect('joe');

  it('generates a workflow with 3 steps', async function () {
    const job = JSON.parse(this.res.text);
    const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

    expect(workflowSteps.length).to.equal(3);
  });

  describe('when executing a query-cmr work item and no catalog is returned', function () {
    let retryLimit;
    before(async function () {
      retryLimit = env.workItemRetryLimit;
      env.workItemRetryLimit = 0;
    });

    after(async function () {
      env.workItemRetryLimit = retryLimit;
    });

    it('finds the queued work item, but query-cmr fails to return a catalog for the next work items', async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
      expect(res.status).to.equal(200);
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(2);
      expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:stable');
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [];
      await updateWorkItem(this.backend, workItem);
    });

    describe('when checking the jobs listing', function () {
      it('shows the job as failed with an internal harmony error', async function () {
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.status).to.equal('failed');
        expect(job.message).to.equal('Harmony internal failure: service did not return any outputs.');
      });
    });
  });
});


describe('Workflow chaining for a collection configured for Swath Projector and netcdf-to-zarr', function () {
  let pageStub;
  let sizeOfObjectStub;
  before(function () {
    pageStub = stub(env, 'cmrMaxPageSize').get(() => 3);
    sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
      .callsFake(async (_) => 7000000000);
  });
  after(function () {
    if (pageStub.restore) {
      pageStub.restore();
    }
    if (sizeOfObjectStub.restore) {
      sizeOfObjectStub.restore();
    }
  });
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();
  describe('when requesting to both reproject and reformat for two granules', function () {
    const reprojectAndZarrQuery = {
      maxResults: 2,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-zarr',
      concatenate: false, // Aggregated workflows are tested above
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
    hookRedirect('joe');

    it('generates a workflow with 3 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(3);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:stable');
    });

    it('then requests reprojection using Swath Projector', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/harmony-swath-projector:latest');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
    });

    it('returns a human-readable message field indicating the request has been limited to a subset of the granules', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.equal('CMR query identified 177 granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults.');
    });

    // Verify it only queues a work item for the query-cmr task
    describe('when checking for a Swath Projector work item', function () {
      hookGetWorkForService('ghcr.io/nasa/harmony-swath-projector:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a netcdf-to-zarr work item', function () {
      hookGetWorkForService('ghcr.io/nasa/harmony-netcdf-to-zarr:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a query-cmr work item', function () {
      it('finds the item and can complete it', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
        expect(res.status).to.equal(200);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(2);
        expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:stable');
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json'),
        ];
        workItem.outputItemSizes = [1, 2];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
        await updateWorkItem(this.backend, workItem);
      });

      describe('when checking to see if Swath Projector work is queued', function () {
        it('finds a swath-projector service work item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          expect(res.status).to.equal(200);
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [getStacLocation(workItem, 'catalog.json')];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id);
          await updateWorkItem(this.backend, workItem);
          expect(workItem.serviceID).to.equal('ghcr.io/nasa/harmony-swath-projector:latest');
        });

        describe('when checking to see if netcdf-to-zarr work is queued', function () {
          let res;
          let workItem;
          before(async function () {
            res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
            // eslint-disable-next-line prefer-destructuring
            workItem = JSON.parse(res.text).workItem;
          });
          it('finds a netcdf-to-zarr service work item', async function () {
            expect(res.status).to.equal(200);
            expect(workItem.serviceID).to.equal('ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
          });
          it('limits the operation on the work-item to reformating', function () {
            const { operation } = workItem;
            // only 'concatenate' and 'reformat' operations allowed for netcdf-to-zarr, and
            // 'concatenate' was set to 'false' in the request
            expect(operation.subset).to.eql({});
            expect(operation.concatenate).to.be.false;
            expect(operation.format).to.eql({
              'mime': 'application/x-zarr',
              'scaleSize': {
                'x': 1.1,
                'y': 2,
              },
            });
          });
          it('can complete the work item', async function () {
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            res = await updateWorkItem(this.backend, workItem);
            expect(res.status).to.equal(204);
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as in progress and 52 percent complete because query-cmr is completely done and 1 of 2 granules is complete in the other services', async function () {
              const jobs = await Job.forUser(db, 'anonymous');
              const job = jobs.data[0];
              expect(job.status).to.equal('running');
              expect(job.progress).to.equal(52);
            });
          });

          describe('when completing all steps for the second granule', function () {
            it('wish I could do this in the describe', async function () {
              for await (const service of ['ghcr.io/nasa/harmony-swath-projector:latest', 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest']) {
                res = await getWorkForService(this.backend, service);
                // eslint-disable-next-line prefer-destructuring
                workItem = JSON.parse(res.text).workItem;
                workItem.status = WorkItemStatus.SUCCESSFUL;
                workItem.results = [getStacLocation(workItem, 'catalog.json')];
                workItem.outputItemSizes = [2];
                await fakeServiceStacOutput(workItem.jobID, workItem.id);
                await updateWorkItem(this.backend, workItem);
              }
            });

            describe('when checking the jobs listing', function () {
              it('marks the job as successful and progress of 100 with 5 links', async function () {
                const job = await getFirstJob(db);
                expect(job.status).to.equal('successful');
                expect(job.progress).to.equal(100);
                expect(job.links.length).to.equal(5);
              });
            });
          });
        });
      });
    });
  });

  describe('when making a request and the job fails while in progress', function () {
    const reprojectAndZarrQuery = {
      maxResults: 3,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-zarr',
      ignoreErrors: false,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
    hookRedirect('joe');

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(3);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [
        getStacLocation(workItem, 'catalog0.json'),
        getStacLocation(workItem, 'catalog1.json'),
        getStacLocation(workItem, 'catalog2.json'),
      ];
      workItem.outputItemSizes = [1, 1, 1];
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
      await updateWorkItem(this.backend, workItem);
      // since there were multiple query cmr results,
      // multiple work items should be generated for the next step
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(4);
      expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
    });

    describe('when the first swath-projector service work item fails with an error message', function () {
      let firstSwathItem;

      before(async function () {
        let shouldLoop = true;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          firstSwathItem = JSON.parse(res.text).workItem;
          firstSwathItem.status = WorkItemStatus.FAILED;
          firstSwathItem.message = 'That was just a practice try, right?';
          firstSwathItem.results = [];
          await updateWorkItem(this.backend, firstSwathItem);

          // check to see if the work-item has failed completely
          const workItem = await getWorkItemById(db, firstSwathItem.id);
          shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
        }
      });

      it('fails the job, and all further work items are canceled', async function () {
      // work item failure should trigger job failure
        const { job } = await Job.byJobID(db, firstSwathItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
        // job failure should trigger cancellation of any pending work items
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:stable').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
      });

      it('sets the job failure message to the error message returned by the service', async function () {
        const { job } = await Job.byJobID(db, firstSwathItem.jobID);
        expect(job.message).to.contain('That was just a practice try, right?');
      });

      it('does not find any further swath-projector work', async function () {
        const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
        expect(res.status).to.equal(404);
      });

      it('does not allow any further work item updates', async function () {
        firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
        await updateWorkItem(this.backend, firstSwathItem);

        const currentWorkItems = (await getWorkItemsByJobId(db, firstSwathItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:stable').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
      });
    });
  });

  describe('when making a request and the job fails while in progress', function () {
    const reprojectAndZarrQuery = {
      maxResults: 3,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-zarr',
      ignoreErrors: false,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
    hookRedirect('joe');

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(3);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [
        getStacLocation(workItem, 'catalog0.json'),
        getStacLocation(workItem, 'catalog1.json'),
        getStacLocation(workItem, 'catalog2.json'),
      ];
      workItem.outputItemSizes = [1, 1, 1];
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
      await updateWorkItem(this.backend, workItem);
      // since there were multiple query cmr results,
      // multiple work items should be generated for the next step
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(4);
      expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
    });

    describe('when the first swath-projector service work item fails and does not provide an error message', function () {
      let firstSwathItem;

      before(async function () {
        let shouldLoop = true;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          firstSwathItem = JSON.parse(res.text).workItem;
          firstSwathItem.status = WorkItemStatus.FAILED;
          firstSwathItem.results = [];
          await updateWorkItem(this.backend, firstSwathItem);

          // check to see if the work-item has failed completely
          const workItem = await getWorkItemById(db, firstSwathItem.id);
          shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
        }
      });

      it('fails the job', async function () {
        const { job } = await Job.byJobID(db, firstSwathItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });

      it('sets the job failure message to a generic failure', async function () {
        const { job } = await Job.byJobID(db, firstSwathItem.jobID);
        expect(job.message).to.contain('failed with an unknown error');
      });
    });
  });

  describe('when requesting to reformat to zarr, no reprojection', function () {
    const zarrOnlyQuery = {
      maxResults: 2,
      format: 'application/x-zarr',
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: zarrOnlyQuery, username: 'joe' });
    hookRedirect('joe');

    it('generates a workflow with 2 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(2);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:stable');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
    });
  });

  describe('when requesting to reproject, but not reformat', function () {
    const reprojectOnlyQuery = {
      maxResults: 2,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-netcdf4',
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectOnlyQuery });
    hookRedirect('joe');

    it('generates a workflow with 2 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(2);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:stable');
    });

    it('then requests reprojection using the Swath Projector', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/harmony-swath-projector:latest');
    });
  });
});

describe('When a request spans multiple CMR pages', function () {
  describe('and contains no aggregating steps', function () {
    const collection = 'C1233800302-EEDTEST';
    hookServersStartStop();
    let pageStub;
    let sizeOfObjectStub;
    before(async function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 3);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 7000000000);
      await truncateAll();
      resetQueues();
    });
    after(async function () {
      pageStub.restore();
      sizeOfObjectStub.restore();
      resetQueues();
      await truncateAll();
    });

    describe('when requesting five granules', function () {

      const multiPageQuery = {
        maxResults: 5,
        outputCrs: 'EPSG:4326',
        interpolation: 'near',
        scaleExtent: '0,2500000.3,1500000,3300000',
        scaleSize: '1.1,2',
        format: 'application/x-zarr',
        concatenate: false,
      };

      hookRangesetRequest('1.0.0', collection, 'all', { query: multiPageQuery });
      hookRedirect('joe');

      describe('when checking for a query-cmr work item', function () {
        it('finds a query-cmr item along with a maxCmrGranules limit', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).equals(3);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
            getStacLocation(workItem, 'catalog2.json'),
          ];
          workItem.outputItemSizes = [1, 1, 1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
          await updateWorkItem(this.backend, workItem);
          // sanity check that 3 swath-projector items were generated by the first query-cmr task
          const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, workItem.jobID, 2)).workItems.length;
          expect(queuedCount).equals(3);
        });

        it('limits the next query-cmr task based on how many STAC items have already been generated', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).equals(2);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
          ];
          workItem.outputItemSizes = [1, 1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
          await updateWorkItem(this.backend, workItem);
          // sanity check that 2 more swath-projector items were generated by the second query-cmr task
          const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, workItem.jobID, 2)).workItems.length;
          expect(queuedCount).equals(5);
        });

        it('does not generate any more work for query-cmr once the next step work items are generated', async function () {
          const nextStepWorkResponse = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
          expect(nextStepWorkResponse.statusCode).to.equal(404);
        });

        it('does not define maxCmrGranules for non-query-cmr items', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).equals(undefined);
          expect(workItem).to.not.equal(undefined);
        });
      });
    });
  });

  describe('and contains an aggregating step', async function () {
    const aggregateService = 'bar';
    hookServersStartStop();

    let pageStub;
    before(async function () {
      await truncateAll();
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 3);

      const job = buildJob({ numInputGranules: 5 });
      await job.save(db);
      this.jobID = job.jobID;

      await buildWorkflowStep({
        jobID: job.jobID,
        serviceID: 'harmonyservices/query-cmr:stable',
        stepIndex: 1,
        is_sequential: true,
        workItemCount: 2,
      }).save(db);

      await buildWorkflowStep({
        jobID: job.jobID,
        serviceID: aggregateService,
        stepIndex: 2,
        workItemCount: 0,
        hasAggregatedOutput: true,
      }).save(db);

      await buildWorkItem({
        jobID: job.jobID,
        serviceID: 'harmonyservices/query-cmr:stable',
        workflowStepIndex: 1,
        scrollID: '123abc',
      }).save(db);

      await populateUserWorkFromWorkItems(db);
    });

    after(async function () {
      pageStub.restore();
      await truncateAll();
    });

    describe('when checking for a query-cmr work item', function () {
      it('finds a query-cmr item along with a maxCmrGranules limit', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(3);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json'),
          getStacLocation(workItem, 'catalog2.json')];
        workItem.outputItemSizes = [1, 1, 1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
        await updateWorkItem(this.backend, workItem);
      });

      it('sets job progress to 42 after completing the first query-cmr work-item', async function () {
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.progress).to.equal(42);
      });

      it('does not generate the aggregation step until all query-cmr items are finished', async function () {
        const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, this.jobID, 2)).workItems.length;
        expect(queuedCount).equals(0);
      });

      it('limits the next query-cmr task based on how many STAC items have already been generated', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(2);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json')];
        workItem.outputItemSizes = [1, 1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
        await updateWorkItem(this.backend, workItem);
      });

      it('sets job progress to 50 after completing all the query-cmr work-items', async function () {
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.progress).to.equal(50);
      });

      it('queues the aggregating work item once all query-cmr items are finished', async function () {
        const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, this.jobID, 2)).workItems.length;
        expect(queuedCount).equals(1);
      });

      it('does not generate any more work for query-cmr once the next step work items are generated', async function () {
        const nextStepWorkResponse = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
        expect(nextStepWorkResponse.statusCode).to.equal(404);
      });

      it('does not define maxCmrGranules for non-query-cmr items', async function () {
        const res = await getWorkForService(this.backend, aggregateService);
        expect(res.statusCode).to.equal(200);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(undefined);
        expect(workItem).to.not.equal(undefined);
      });
    });
  });

  describe('and the number of granules returned by the CMR changes while paging', function () {
    const aggregateService = 'bar';
    const nonAggregateService = 'foo';
    const sessionId = uuid();
    const initialCmrHits = 3;
    const initialQueryCmrWorkItemCount = initialCmrHits;
    let stubCmrMaxPageSize;

    before(function () {
      stubCmrMaxPageSize = stub(env, 'cmrMaxPageSize').get(() => 1);
    });

    hookServersStartStop();

    after(async function () {
      await truncateAll();
      delete this.jobID;
      stubCmrMaxPageSize.restore();
    });

    describe('while retrieving granules from the CMR', function () {
      describe('when the CMR hits decreases', function () {
        const finalCmrHits = 2;
        let finalQueryCmrWorkItemCount;
        before(async function () {
          await truncateAll();
          finalQueryCmrWorkItemCount = Math.ceil(finalCmrHits / env.cmrMaxPageSize);
          this.jobID = await createJobAndWorkItems(initialCmrHits, initialQueryCmrWorkItemCount, nonAggregateService, aggregateService);
          await testInitialConditions(initialCmrHits, initialQueryCmrWorkItemCount);

          for (let i = 0; i < finalQueryCmrWorkItemCount; i++) {
            const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.hits = finalCmrHits;
            workItem.scrollID = `${sessionId}:["abc",123,456]`;
            workItem.results = [
              getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
            await updateWorkItem(this.backend, workItem);
          }
        });
        it('updates the job numInputGranules', async function () {
          const { job } = await Job.byJobID(db, this.jobID);
          expect(job.numInputGranules).equals(finalCmrHits);
        });

        it('updates the number of work items for the query-cmr step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 1);
          expect(workflowStep.workItemCount).equals(finalQueryCmrWorkItemCount);
        });

        it('updates the number of work items for the second step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 2);
          expect(workflowStep.workItemCount).equals(finalCmrHits);
        });

        it('does not update the number of work items for the aggregating step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 3);
          expect(workflowStep.workItemCount).equals(0);
        });

        describe('and the number of worked items matches the new number', async function () {
          before(async function () {
            for (let i = 0; i < finalCmrHits; i++) {
              const res = await getWorkForService(this.backend, nonAggregateService);
              const { workItem } = JSON.parse(res.text);
              workItem.status = WorkItemStatus.SUCCESSFUL;
              workItem.results = [
                getStacLocation(workItem, 'catalog.json')];
              workItem.outputItemSizes = [1];
              await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
              await updateWorkItem(this.backend, workItem);
            }

            const res = await getWorkForService(this.backend, aggregateService);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [
              getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
            await updateWorkItem(this.backend, workItem);

          });
          it('completes the job', async function () {
            const { job } = await Job.byJobID(db, this.jobID);
            expect(job.status).equals(JobStatus.SUCCESSFUL);
          });
        });
      });

      describe('when the CMR hits increases', async function () {
        const finalCmrHits = 5;
        before(async function () {
          await truncateAll();
          this.jobID = await createJobAndWorkItems(initialCmrHits, initialQueryCmrWorkItemCount, nonAggregateService, aggregateService);
          await testInitialConditions(initialCmrHits, initialQueryCmrWorkItemCount);

          for (let i = 0; i < initialQueryCmrWorkItemCount; i++) {
            const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.hits = finalCmrHits;
            workItem.scrollID = `${sessionId}:["abc",123,456]`;
            workItem.results = [
              getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
            await updateWorkItem(this.backend, workItem);
          }
        });

        it('does not look for more granules for the job', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
          expect(res.statusCode).equals(404);
        });

        it('does not update the job numInputGranules', async function () {
          const { job } = await Job.byJobID(db, this.jobID);
          expect(job.numInputGranules).equals(initialCmrHits);
        });

        it('does not update the number of work items for the query-cmr step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 1);
          expect(workflowStep.workItemCount).equals(initialQueryCmrWorkItemCount);
        });

        it('does not update the number of work items for the second step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 2);
          expect(workflowStep.workItemCount).equals(initialCmrHits);
        });

        it('does not update the number of work items for the aggregating step', async function () {
          const workflowStep = await getWorkflowStepByJobIdStepIndex(db, this.jobID, 3);
          expect(workflowStep.workItemCount).equals(0);
        });

        describe('and the number of worked items matches the initial number', function () {
          before(async function () {
            for (let i = 0; i < initialCmrHits; i++) {
              const res = await getWorkForService(this.backend, nonAggregateService);
              const { workItem } = JSON.parse(res.text);
              workItem.status = WorkItemStatus.SUCCESSFUL;
              workItem.results = [
                getStacLocation(workItem, 'catalog.json')];
              workItem.outputItemSizes = [1];
              await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
              await updateWorkItem(this.backend, workItem);
            }

            const res = await getWorkForService(this.backend, aggregateService);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [
              getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
            await updateWorkItem(this.backend, workItem);

          });
          it('completes the job', async function () {
            const { job } = await Job.byJobID(db, this.jobID);
            expect(job.status).equals(JobStatus.SUCCESSFUL);
          });
        });
      });
    });
  });
});
