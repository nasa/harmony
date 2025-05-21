import { expect } from 'chai';
import { stub } from 'sinon';
import { v4 as uuid } from 'uuid';

import { Job, JobStatus } from '../app/models/job';
import {
  getCount, populateUserWorkFromWorkItems, recalculateCounts,
} from '../app/models/user-work';
import {
  getWorkItemById, getWorkItemsByJobId, getWorkItemsByJobIdAndStepIndex,
} from '../app/models/work-item';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import {
  getWorkflowStepByJobIdStepIndex, getWorkflowStepsByJobId,
} from '../app/models/workflow-steps';
import * as aggregationBatch from '../app/util/aggregation-batch';
import db from '../app/util/db';
import env from '../app/util/env';
import { truncateAll } from './helpers/db';
import { hookRedirect } from './helpers/hooks';
import { buildJob, getFirstJob } from './helpers/jobs';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import { resetQueues } from './helpers/queue';
import hookServersStartStop from './helpers/servers';
import {
  buildWorkItem, fakeServiceStacOutput, getWorkForService, hookGetWorkForService, updateWorkItem,
} from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';

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
  const collection = 'C1260128044-EEDTEST'; // ATL16, requires HOSS and MaskFill to do a bbox subset
  hookServersStartStop();
  const hossAndMaskfillQuery = {
    maxResults: 2,
    subset: 'lat(80:85)',
    format: 'application/x-netcdf4',
  };

  hookRangesetRequest('1.0.0', collection, 'all', { query: hossAndMaskfillQuery });
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
        expect(job.message).to.equal('WorkItem failed: Service did not return any outputs.');
      });
    });
  });
});


describe('Workflow chaining for collections configured with multi-step chains', function () {
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
  const collection = 'C1260128044-EEDTEST'; // ATL16, requires HOSS and MaskFill to do a bbox subset
  hookServersStartStop();
  describe('when requesting to spatially subset two projection-gridded granules', function () {
    const hossAndMaskfillQuery = {
      maxResults: 2,
      subset: 'lat(80:85)',
      format: 'application/x-netcdf4',
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: hossAndMaskfillQuery });
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

    it('then requests data from OPeNDAP using HOSS', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/harmony-opendap-subsetter:latest');
    });

    it('then requests masking using MaskFill', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('sds/maskfill-harmony:latest');
    });

    it('returns a human-readable message field indicating the request has been limited to a subset of the granules', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.equal('CMR query identified 27 granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults.');
    });

    // Verify it only queues a work item for the query-cmr task
    describe('when checking for a HOSS work item', function () {
      hookGetWorkForService('ghcr.io/nasa/harmony-opendap-subsetter:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a MaskFill work item', function () {
      hookGetWorkForService('sds/maskfill-harmony:latest');

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

      describe('when checking to see if HOSS work is queued', function () {
        it('finds a HOSS service work item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
          expect(res.status).to.equal(200);
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [getStacLocation(workItem, 'catalog.json')];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id);
          await updateWorkItem(this.backend, workItem);
          expect(workItem.serviceID).to.equal('ghcr.io/nasa/harmony-opendap-subsetter:latest');
        });

        describe('when checking to see if MaskFill work is queued', function () {
          let res;
          let workItem;
          before(async function () {
            res = await getWorkForService(this.backend, 'sds/maskfill-harmony:latest');
            // eslint-disable-next-line prefer-destructuring
            workItem = JSON.parse(res.text).workItem;
          });
          it('finds a MaskFill service work item', async function () {
            expect(res.status).to.equal(200);
            expect(workItem.serviceID).to.equal('sds/maskfill-harmony:latest');
          });
          it('limits the operation on the work-item to bbox subsetting', function () {
            const { operation } = workItem;
            expect(operation.subset).to.eql({ bbox: [-180, 80, 180, 85] });
            expect(operation.concatenate).to.be.false;
            expect(operation.format).to.eql({});
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
              for await (const service of ['ghcr.io/nasa/harmony-opendap-subsetter:latest', 'sds/maskfill-harmony:latest']) {
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

  describe('when a request has service returns nodata warning', function () {
    const hossAndMaskfillQuery = {
      maxResults: 2,
      subset: 'lat(80:85)',
      format: 'application/x-netcdf4',
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: hossAndMaskfillQuery });
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

    it('then requests data from OPeNDAP using HOSS', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/harmony-opendap-subsetter:latest');
    });

    it('then requests masking using MaskFill', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('sds/maskfill-harmony:latest');
    });

    it('returns a human-readable message field indicating the request has been limited to a subset of the granules', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.equal('CMR query identified 27 granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults.');
    });

    // Verify it only queues a work item for the query-cmr task
    describe('when checking for a HOSS work item', function () {
      hookGetWorkForService('ghcr.io/nasa/harmony-opendap-subsetter:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a MaskFill work item', function () {
      hookGetWorkForService('sds/maskfill-harmony:latest');

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

      describe('when a service returns a nodata warning', function () {
        let firstHossItem;

        before(async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
          firstHossItem = JSON.parse(res.text).workItem;
          firstHossItem.status = WorkItemStatus.WARNING;
          firstHossItem.message = 'The service found nodata to process';
          firstHossItem.message_category = 'nodata';
          firstHossItem.results = [];
          await updateWorkItem(this.backend, firstHossItem);
        });

        describe('when checking to see if MaskFill work is queued', function () {
          let res;
          let workItem;
          before(async function () {
            res = await getWorkForService(this.backend, 'sds/maskfill-harmony:latest');
          });
          it('does not find any MaskFill service work item', async function () {
            expect(res.status).to.equal(404);
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as in progress and 28 percent complete because query-cmr is completely done and 1 granule only completes in one step', async function () {
              const jobs = await Job.forUser(db, 'anonymous');
              const job = jobs.data[0];
              expect(job.status).to.equal('running');
              expect(job.progress).to.equal(28);
            });
          });

          describe('when completing all steps for the second granule', function () {
            it('wish I could do this in the describe', async function () {
              for await (const service of ['ghcr.io/nasa/harmony-opendap-subsetter:latest', 'sds/maskfill-harmony:latest']) {
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
              it('marks the job as successful and progress of 100 with 3 links', async function () {
                const job = await getFirstJob(db);
                expect(job.status).to.equal('successful');
                expect(job.progress).to.equal(100);
                expect(job.links.length).to.equal(3);
                expect(job.message).to.equal('WorkItem warned: The service found nodata to process');
              });
            });
          });
        });
      });
    });
  });

  describe('when making a request and the job fails while in progress', function () {
    const hossAndMaskfillQuery = {
      maxResults: 3,
      subset: 'lat(80:85)',
      format: 'application/x-netcdf4',
      ignoreErrors: false, // Without this, the job status becomes running_with_errors
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: hossAndMaskfillQuery });
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
      expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(3);
    });

    describe('when the first HOSS service work item fails with an error message', function () {
      let firstHossItem;

      before(async function () {
        let shouldLoop = true;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
          firstHossItem = JSON.parse(res.text).workItem;
          firstHossItem.status = WorkItemStatus.FAILED;
          firstHossItem.message = 'That was just a practice try, right?';
          firstHossItem.results = [];
          await updateWorkItem(this.backend, firstHossItem);

          // check to see if the work-item has failed completely
          const workItem = await getWorkItemById(db, firstHossItem.id);
          shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
        }
      });

      it('fails the job, and all further work items are canceled', async function () {
        // work item failure should trigger job failure
        const { job } = await Job.byJobID(db, firstHossItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
        // job failure should trigger cancellation of any pending work items
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:stable').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(1);
      });

      it('sets the job failure message to the error message returned by the service', async function () {
        const { job } = await Job.byJobID(db, firstHossItem.jobID);
        expect(job.message).to.contain('That was just a practice try, right?');
      });

      it('does not find any further HOSS work', async function () {
        const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
        expect(res.status).to.equal(404);
      });

      it('does not allow any further work item updates', async function () {
        firstHossItem.status = WorkItemStatus.SUCCESSFUL;
        await updateWorkItem(this.backend, firstHossItem);

        const currentWorkItems = (await getWorkItemsByJobId(db, firstHossItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:stable').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(1);
      });
    });
  });

  describe('when making a request and the job fails while in progress', function () {
    const hossAndMaskfillQuery = {
      maxResults: 3,
      subset: 'lat(80:85)',
      format: 'application/x-netcdf4',
      ignoreErrors: false,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: hossAndMaskfillQuery });
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
      expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-opendap-subsetter:latest').length).to.equal(3);
    });

    describe('when the first HOSS service work item fails and does not provide an error message', function () {
      let firstHossItem;

      before(async function () {
        let shouldLoop = true;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
          firstHossItem = JSON.parse(res.text).workItem;
          firstHossItem.status = WorkItemStatus.FAILED;
          firstHossItem.results = [];
          await updateWorkItem(this.backend, firstHossItem);

          // check to see if the work-item has failed completely
          const workItem = await getWorkItemById(db, firstHossItem.id);
          shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
        }
      });

      it('fails the job', async function () {
        const { job } = await Job.byJobID(db, firstHossItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });

      it('sets the job failure message to a generic failure', async function () {
        const { job } = await Job.byJobID(db, firstHossItem.jobID);
        expect(job.message).to.contain('failed with an unknown error');
      });
    });
  });

  describe('when requesting to aggregation (Concise), no subsetting', function () {
    // This test shows the L2SS step is skipped because none of the operations
    // it requires in a request are specified.
    const conciseOnlyQuery = {
      maxResults: 2,
      concatenate: true,
    };
    const conciseCollection = 'C1243729749-EEDTEST';

    hookRangesetRequest('1.0.0', conciseCollection, 'all', { query: conciseOnlyQuery, username: 'joe' });
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

    it('then requests reformatting using Concise', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/concise:sit');
    });
  });

  describe('when requesting to subset, but not concatenate', function () {
    const conciseCollection = 'C1243729749-EEDTEST';
    const subsetOnlyQuery = {
      maxResults: 2,
      subset: 'lat(0:10)',
      concatenate: false,
    };

    hookRangesetRequest('1.0.0', conciseCollection, 'all', { query: subsetOnlyQuery });
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

    it('then requests subsetting using L2SS', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/l2ss-py:sit');
    });
  });
});

// HARMONY-2037
describe('Workflow chaining for a collection configured for SAMBAH', function () {
  let pageStub;
  let sizeOfObjectStub;
  before(async function () {
    await truncateAll();
    pageStub = stub(env, 'cmrMaxPageSize').get(() => 4);
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

  const collection = 'C1254854453-LARC_CLOUD';
  hookServersStartStop();
  describe('when requesting both extend and concatenate without subsetting for four granules', function () {
    const sambahQuery = {
      maxResults: 4,
      extend: true,
      concatenate: true,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: sambahQuery });
    hookRedirect('joe');

    it('generates a workflow with 4 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
      // we didn't ask for subsetting, so no l2ss
      expect(workflowSteps.length).to.equal(4);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:stable');
    });

    it('then requests batching using batchee', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('ghcr.io/nasa/batchee:latest');
    });

    it('then requests extension using stitchee', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('ghcr.io/nasa/stitchee:latest');
    });

    it('then requests concatenation using concise', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[3].serviceID).to.equal('ghcr.io/podaac/concise:sit');
    });

    describe('when checking for a query-cmr work item', function () {
      it('finds the item and can complete it', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
        expect(res.status).to.equal(200);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(4);
        expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:stable');
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json'),
          getStacLocation(workItem, 'catalog2.json'),
          getStacLocation(workItem, 'catalog3.json'),
        ];
        workItem.outputItemSizes = [1, 2, 3, 4];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 4);
        await updateWorkItem(this.backend, workItem);
      });

      describe('when checking to see if l2ss is queued', function () {
        it('does not find l2ss work items', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
          expect(res.status).to.equal(404);
        });

        describe('when checking to see if batchee is queued', function () {
          let res;
          let workItem;
          before(async function () {
            res = await getWorkForService(this.backend, 'ghcr.io/nasa/batchee:latest');
            // eslint-disable-next-line prefer-destructuring
            workItem = JSON.parse(res.text).workItem;
          });
          it('finds a batchee service work item', async function () {
            expect(res.status).to.equal(200);
            expect(workItem.serviceID).to.equal('ghcr.io/nasa/batchee:latest');
          });
          it('can complete the work item', async function () {
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [
              getStacLocation(workItem, 'catalog0.json'),
              getStacLocation(workItem, 'catalog1.json'),
            ];
            workItem.outputItemSizes = [1, 2];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
            res = await updateWorkItem(this.backend, workItem);
            expect(res.status).to.equal(204);
          });

          describe('when checking to see if stitchee is queued', function () {
            it('it finds exactly two work items', async function () {
              for await (const service of ['ghcr.io/nasa/stitchee:latest', 'ghcr.io/nasa/stitchee:latest']) {
                res = await getWorkForService(this.backend, service);
                // eslint-disable-next-line prefer-destructuring
                workItem = JSON.parse(res.text).workItem;
                workItem.status = WorkItemStatus.SUCCESSFUL;
                workItem.results = [getStacLocation(workItem, 'catalog.json')];
                workItem.outputItemSizes = [2];
                await fakeServiceStacOutput(workItem.jobID, workItem.id);
                await updateWorkItem(this.backend, workItem);
              }

              res = await getWorkForService(this.backend, 'ghcr.io/nasa/stitchee:latest');
              expect(res.status).to.equal(404);
            });

          });
        });
      });
    });
  });
});

describe('When a request spans multiple CMR pages', function () {
  describe('and contains no aggregating steps', function () {
    const collection = 'C1260128044-EEDTEST'; // ATL16, requires HOSS and MaskFill to do a bbox subset
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
        subset: 'lat(80:85)',
        format: 'application/x-netcdf4',
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
          // sanity check that 3 HOSS items were generated by the first query-cmr task
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
          // sanity check that 2 more HOSS items were generated by the second query-cmr task
          const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, workItem.jobID, 2)).workItems.length;
          expect(queuedCount).equals(5);
        });

        it('does not generate any more work for query-cmr once the next step work items are generated', async function () {
          const nextStepWorkResponse = await getWorkForService(this.backend, 'harmonyservices/query-cmr:stable');
          expect(nextStepWorkResponse.statusCode).to.equal(404);
        });

        it('does not define maxCmrGranules for non-query-cmr items', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-opendap-subsetter:latest');
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

describe('when a job is paused and a work item completes', function () {
  const exampleService = 'harmonyservices/service-example:latest';
  const queryCmrService = 'harmonyservices/query-cmr:latest';
  let jobId;

  hookServersStartStop();

  before(async function () {
    await truncateAll();
    const job = buildJob({ status: JobStatus.PAUSED, numInputGranules: 4 });
    await job.save(db);
    jobId = job.jobID;

    await buildWorkflowStep({
      jobID: jobId,
      serviceID: queryCmrService,
      stepIndex: 1,
      workItemCount: 1,
    }).save(db);

    await buildWorkflowStep({
      jobID: jobId,
      serviceID: exampleService,
      stepIndex: 2,
      workItemCount: 4,
    }).save(db);

    await buildWorkItem({
      jobID: jobId,
      serviceID: queryCmrService,
      status: WorkItemStatus.READY,
      workflowStepIndex: 1,
    }).save(db);

    await buildWorkItem({
      jobID: jobId,
      serviceID: exampleService,
      status: WorkItemStatus.READY,
      workflowStepIndex: 2,
    }).save(db);

    await buildWorkItem({
      jobID: jobId,
      serviceID: exampleService,
      status: WorkItemStatus.READY,
      workflowStepIndex: 2,
    }).save(db);

    await buildWorkItem({
      jobID: jobId,
      serviceID: exampleService,
      status: WorkItemStatus.RUNNING,
      workflowStepIndex: 2,
    }).save(db);

    await buildWorkItem({
      jobID: jobId,
      serviceID: exampleService,
      status: WorkItemStatus.RUNNING,
      workflowStepIndex: 2,
    }).save(db);

    await populateUserWorkFromWorkItems(db);
    await recalculateCounts(db, jobId);
  });

  it('initially has the correct ready and running counts', async function () {
    const readyCount = await getCount(db, jobId, exampleService, 'ready');
    const runningCount = await getCount(db, jobId, exampleService, 'running');
    expect(readyCount).to.equal(2);
    expect(runningCount).to.equal(2);
  });

  describe('after completing a work item for the paused job', function () {
    before(async function () {
      const res = await getWorkForService(this.backend, exampleService);
      expect(res.status).to.equal(200);
      const { workItem } = JSON.parse(res.text);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [getStacLocation(workItem, 'catalog.json')];
      workItem.outputItemSizes = [1];
      await fakeServiceStacOutput(workItem.jobID, workItem.id);
      await updateWorkItem(this.backend, workItem);
    });

    it('sets the ready_count to 0 for all services associated with the job', async function () {
      const queryCmrReadyCount = await getCount(db, jobId, queryCmrService, 'ready');
      const exampleReadyCount = await getCount(db, jobId, exampleService, 'ready');
      expect(queryCmrReadyCount).to.equal(0);
      expect(exampleReadyCount).to.equal(0);
    });

    it('does not change the running count for the example service', async function () {
      const runningCount = await getCount(db, jobId, exampleService, 'running');
      expect(runningCount).to.equal(3);
    });

    it('does not change the running count for the query-cmr service', async function () {
      const runningCount = await getCount(db, jobId, queryCmrService, 'running');
      expect(runningCount).to.equal(1);
    });

    it('keeps the job status as paused', async function () {
      const { job } = await Job.byJobID(db, jobId);
      expect(job.status).to.equal(JobStatus.PAUSED);
    });
  });
});
