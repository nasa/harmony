import { expect } from 'chai';
import { stub } from 'sinon';
import WorkItem, { getWorkItemById, getWorkItemsByJobId } from '../app/models/work-item';
import db from '../app/util/db';
import { Job, JobStatus } from '../app/models/job';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import { fakeServiceStacOutput, getWorkForService, updateWorkItem } from './helpers/work-items';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';
import env from '../app/util/env';
import { jobStatus } from './helpers/jobs';
import * as aggregationBatch from '../app/util/aggregation-batch';
import { resetQueues } from './helpers/queue';

const reprojectAndZarrQuery = {
  maxResults: 1,
  outputCrs: 'EPSG:4326',
  interpolation: 'near',
  scaleExtent: '0,2500000.3,1500000,3300000',
  scaleSize: '1.1,2',
  format: 'application/x-zarr',
  concatenate: false,
};

const l2ssAndConciseQuery = {
  subset: 'lat(0:90)',
  concatenate: false,
  maxResults: 1,
  ignoreErrors: true,
};

const collection = 'C1233800302-EEDTEST';
const l2ssCollection = 'C1243729749-EEDTEST';

describe('ignoreErrors', function () {
  hookServersStartStop();

  let sizeOfObjectStub;
  before(async function () {
    sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
      .callsFake(async (_) => 1);
    await truncateAll();
    resetQueues();
  });

  after(async function () {
    sizeOfObjectStub.restore();
    resetQueues();
    await truncateAll();
  });

  describe('when setting ignoreErrors=true', function () {
    describe('when making a request for a single granule and it completes successfully', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 1, ignoreErrors: true } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(1);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog.json'),
        ];
        workItem.outputItemSizes = [1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
        await updateWorkItem(this.backend, workItem);
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(2);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
      });

      describe('when all of the work items succeed', function () {
        let firstSwathItem;
        let zarrItem;

        before(async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          firstSwathItem = JSON.parse(res.text).workItem;
          firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
          firstSwathItem.results = [
            getStacLocation(firstSwathItem, 'catalog.json'),
          ];
          firstSwathItem.outputItemSizes = [1];
          await fakeServiceStacOutput(firstSwathItem.jobID, firstSwathItem.id);
          await updateWorkItem(this.backend, firstSwathItem);

          const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
          zarrItem = JSON.parse(res2.text).workItem;
          zarrItem.status = WorkItemStatus.SUCCESSFUL;
          zarrItem.results = [
            getStacLocation(zarrItem, 'catalog.json'),
          ];
          await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
          await updateWorkItem(this.backend, zarrItem);
        });

        it('marks the job as successful', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.SUCCESSFUL);
          expect(job.progress).to.equal(100);
          const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(3);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest').length).to.equal(1);
        });

        it('does not find any further Swath Projector work', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          expect(res.status).to.equal(404);
        });

      });
    });

    describe('when making a request for a single granule and one of its work items fails', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 1, ignoreErrors: true } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(1);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog.json'),
        ];
        workItem.outputItemSizes = [1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
        await updateWorkItem(this.backend, workItem);
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(2);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
      });

      describe('when the first Swath Projector work item fails', function () {
        this.timeout(120000);
        let firstSwathItem;

        before(async function () {
          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
            firstSwathItem = JSON.parse(res.text).workItem;
            firstSwathItem.status = WorkItemStatus.FAILED;
            firstSwathItem.errorMessage = 'Specific failure reason';
            firstSwathItem.results = [];

            await updateWorkItem(this.backend, firstSwathItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, firstSwathItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('fails the job', async function () {
          // await sleep(100000);
          // work item failure with only one granue should trigger job failure
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
          expect(job.message).to.equal('WorkItem failed: Specific failure reason');
        });

        it('correctly sets the work items status', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, firstSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
        });

        it('does not find any further Swath Projector work', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          expect(res.status).to.equal(404);
        });

        it('does not allow any further work item updates', async function () {
          firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
          await updateWorkItem(this.backend, firstSwathItem);
          const swathItem = await getWorkItemById(db, firstSwathItem.id);
          expect(swathItem.status).to.equal(WorkItemStatus.FAILED);
        });
      });
    });

    describe('when making a request for two granules and both of the granules have one work item fail', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 2, ignoreErrors: true } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(2);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json'),
        ];
        workItem.outputItemSizes = [1, 1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
        await updateWorkItem(this.backend, workItem);
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;

        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
      });

      describe('when the first Swath Projector work item fails', function () {
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

        it('changes the job status to running_with_errors', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(3);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
        });
      });

      describe('when the second Swath Projector item succeeds and then its zarr work item fails', function () {
        let secondSwathItem;
        let zarrItem;

        before(async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          secondSwathItem = JSON.parse(res.text).workItem;
          secondSwathItem.status = WorkItemStatus.SUCCESSFUL;
          secondSwathItem.results = [getStacLocation(secondSwathItem, 'catalog.json')];
          await fakeServiceStacOutput(secondSwathItem.jobID, secondSwathItem.id);
          await updateWorkItem(this.backend, secondSwathItem);

          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
            zarrItem = JSON.parse(res2.text).workItem;
            zarrItem.status = WorkItemStatus.FAILED;
            zarrItem.results = [];
            await updateWorkItem(this.backend, zarrItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, zarrItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('marks the job as failed', async function () {
          // all work items failing should trigger job failure
          const { job } = await Job.byJobID(db, secondSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
          expect(job.message).to.equal('The job failed with 2 errors. See the errors field for more details');
          const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest').length).to.equal(1);
        });
      });
    });

    describe('when making a request for 3 granules and one fails while in progress', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 3, ignoreErrors: true } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
      });

      describe('when the first Swath Projector work item fails', function () {
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

        it('changes the job status to running_with_errors', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
        });

        it('does not queue a zarr step for the work item that failed', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, firstSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
        });

        it('sets the status to COMPLETE_WITH_ERRORS when the other granules complete', async function () {
          const res1 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          const workItem1 = JSON.parse(res1.text).workItem;
          const workItem2 = JSON.parse(res2.text).workItem;

          workItem1.status = WorkItemStatus.SUCCESSFUL;
          workItem1.results = [getStacLocation(workItem1, 'catalog.json')];
          await fakeServiceStacOutput(workItem1.jobID, workItem1.id);
          await updateWorkItem(this.backend, workItem1);

          workItem2.status = WorkItemStatus.SUCCESSFUL;
          workItem2.results = [getStacLocation(workItem2, 'catalog.json')];
          await fakeServiceStacOutput(workItem2.jobID, workItem2.id);
          await updateWorkItem(this.backend, workItem2);

          const res3 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
          const res4 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');

          const workItem3 = JSON.parse(res3.text).workItem;
          const workItem4 = JSON.parse(res4.text).workItem;

          workItem3.status = WorkItemStatus.SUCCESSFUL;
          workItem3.results = [getStacLocation(workItem3, 'catalog.json')];
          await fakeServiceStacOutput(workItem3.jobID, workItem3.id);
          await updateWorkItem(this.backend, workItem3);

          workItem4.status = WorkItemStatus.SUCCESSFUL;
          workItem4.results = [getStacLocation(workItem4, 'catalog.json')];
          await fakeServiceStacOutput(workItem4.jobID, workItem4.id);
          await updateWorkItem(this.backend, workItem4);

          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
          expect(job.progress).to.equal(100);
        });

        it('includes the error details in the job status', async function () {
          const response = await jobStatus(this.frontend, { jobID: firstSwathItem.jobID, username: 'joe' });
          const job = JSON.parse(response.text);
          const { errors } = job;
          expect(errors.length).to.equal(1);
          expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
          expect(errors[0].message).to.include('failed with an unknown error');
        });
      });
    });

    describe('when making a request for 4 granules with max allowed errors of 1 and two fail', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 4, ignoreErrors: true } } });
      hookRedirect('joe');

      let maxErrorsStub;
      before(async function () {
        maxErrorsStub = stub(env, 'maxErrorsForJob').get(() => 1);
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(4);
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

        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(5);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(4);
      });
      after(function () {
        maxErrorsStub.restore();
      });

      describe('when the first granule completes successfully', function () {
        let firstSwathItem;

        before(async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');

          firstSwathItem = JSON.parse(res.text).workItem;
          firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
          firstSwathItem.results = [getStacLocation(firstSwathItem, 'catalog.json')];
          await fakeServiceStacOutput(firstSwathItem.jobID, firstSwathItem.id);
          await updateWorkItem(this.backend, firstSwathItem);

          const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
          const zarrItem = JSON.parse(res2.text).workItem;
          zarrItem.status = WorkItemStatus.SUCCESSFUL;
          zarrItem.results = [getStacLocation(zarrItem, 'catalog.json')];
          await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
          await updateWorkItem(this.backend, zarrItem);
        });

        it('leaves the job in the running state', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING);
        });
      });

      describe('when the second Swath Projector work item fails (first failure)', function () {
        let secondSwathItem;

        before(async function () {
          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
            secondSwathItem = JSON.parse(res.text).workItem;
            secondSwathItem.status = WorkItemStatus.FAILED;
            secondSwathItem.results = [];

            await updateWorkItem(this.backend, secondSwathItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, secondSwathItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('changes the job status to running_with_errors', async function () {
          const { job } = await Job.byJobID(db, secondSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
        });

        it('does not queue a zarr step for the work item that failed', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, secondSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(6);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest').length).to.equal(1);

        });
      });

      describe('when the third Swath Projector work item fails resulting in a (second failure) for the job', function () {
        let thirdSwathItem;

        before(async function () {
          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
            thirdSwathItem = JSON.parse(res.text).workItem;
            thirdSwathItem.status = WorkItemStatus.FAILED;
            thirdSwathItem.results = [];
            thirdSwathItem.errorMessage = 'Did not reach 88 MPH.';

            await updateWorkItem(this.backend, thirdSwathItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, thirdSwathItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('puts the job in a FAILED state', async function () {
          const { job } = await Job.byJobID(db, thirdSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
        });

        it('includes the error details in the job status', async function () {
          const response = await jobStatus(this.frontend, { jobID: thirdSwathItem.jobID, username: 'joe' });
          const job = JSON.parse(response.text);
          const { errors } = job;
          expect(errors.length).to.equal(2);
          expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
          expect(errors[0].message).to.include('failed with an unknown error');
          expect(errors[1].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
          expect(errors[1].message).to.include('Did not reach 88 MPH');
        });

        it('marks any remaining work items as canceled', async function () {
          // job failure should trigger cancellation of any pending work items
          const currentWorkItems = (await getWorkItemsByJobId(db, thirdSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(6);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest').length).to.equal(1);
        });
      });
    });

    describe('when making a request for 4 granules and query-cmr fails', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 4, ignoreErrors: true } } });
      hookRedirect('joe');

      before(async function () {
        let shouldLoop = true;
        let workItem: WorkItem;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          workItem = JSON.parse(res.text).workItem as WorkItem;
          workItem.status = WorkItemStatus.FAILED;
          workItem.results = [];
          workItem.errorMessage = 'Bad scroll session';
          await updateWorkItem(this.backend, workItem);
          // check to see if the work-item has failed completely
          workItem = await getWorkItemById(db, workItem.id);
          shouldLoop = workItem.status != WorkItemStatus.FAILED;
        }

        this.workItem = workItem;
      });

      it('marks the work items as failed', async function () {
        const currentWorkItems = (await getWorkItemsByJobId(db, this.workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
      });

      it('marks the job as failed', async function () {
        const { job } = await Job.byJobID(db, this.workItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });
    });

    describe('When a request spans multiple CMR pages', function () {
      let pageStub;
      before(function () {
        pageStub = stub(env, 'cmrMaxPageSize').get(() => 3);
      });
      after(function () {
        if (pageStub.restore) {
          pageStub.restore();
        }
      });
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 5, ignoreErrors: true } } });
      hookRedirect('joe');

      describe('when completing the first query-cmr work item', function () {

        let workItemJobID;

        before(async function () {
          stub(env, 'cmrMaxPageSize').get(() => 3);
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          const { workItem } = JSON.parse(res.text);
          workItemJobID = workItem.jobID;
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
            getStacLocation(workItem, 'catalog2.json'),
          ];
          workItem.outputItemSizes = [1, 2, 3];
          await updateWorkItem(this.backend, workItem);
        });

        it('queues 3 Swath Projector work items and 1 more query-cmr work item', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, workItemJobID)).workItems;
          expect(currentWorkItems.length).to.equal(5);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
        });

        it('leaves the job in the running state', async function () {
          const { job } = await Job.byJobID(db, workItemJobID);
          expect(job.status).to.equal(JobStatus.RUNNING);
        });

        describe('when the first granule Swath Projector and netcdf-to-zarr work items succeed', async function () {
          let firstSwathItem;

          before(async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');

            firstSwathItem = JSON.parse(res.text).workItem;
            firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
            firstSwathItem.results = [getStacLocation(firstSwathItem, 'catalog.json')];
            await fakeServiceStacOutput(firstSwathItem.jobID, firstSwathItem.id);
            await updateWorkItem(this.backend, firstSwathItem);

            const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
            const zarrItem = JSON.parse(res2.text).workItem;
            zarrItem.status = WorkItemStatus.SUCCESSFUL;
            zarrItem.results = [getStacLocation(zarrItem, 'catalog.json')];
            await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
            await updateWorkItem(this.backend, zarrItem);
          });

          it('leaves the job in the running state', async function () {
            const { job } = await Job.byJobID(db, firstSwathItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING);
          });
        });
      });

      describe('when the next Swath Projector item fails', function () {
        let secondSwathItem;
        before(async function () {
          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
            secondSwathItem = JSON.parse(res.text).workItem;
            secondSwathItem.status = WorkItemStatus.FAILED;
            secondSwathItem.results = [];

            await updateWorkItem(this.backend, secondSwathItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, secondSwathItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('updates the job to the running_with_errors state', async function () {
          const { job } = await Job.byJobID(db, secondSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
        });
      });

      describe('when the next query-cmr work item fails', function () {
        let secondQueryCmrItem;
        before(async function () {
          let shouldLoop = true;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
            secondQueryCmrItem = JSON.parse(res.text).workItem;
            secondQueryCmrItem.status = WorkItemStatus.FAILED;
            secondQueryCmrItem.results = [];

            await updateWorkItem(this.backend, secondQueryCmrItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, secondQueryCmrItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        });

        it('updates the job to the failed state', async function () {
          const { job } = await Job.byJobID(db, secondQueryCmrItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
        });

        it('cancels any remaining work items', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, secondQueryCmrItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(6);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest').length).to.equal(1);
        });
      });
    });

    describe('When a requesting concatenation for a service that batches aggregation requests', function () {
      describe('when making a request for 3 granules and the first one fails while in progress', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 3, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        before(async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
          const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(3);
        });

        describe('when the first L2-Subsetter service work item fails', function () {
          let firstL2SSItem;

          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              firstL2SSItem = JSON.parse(res.text).workItem;
              firstL2SSItem.status = WorkItemStatus.FAILED;
              firstL2SSItem.results = [];

              await updateWorkItem(this.backend, firstL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, firstL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('changes the job status to running_with_errors', async function () {
            const { job } = await Job.byJobID(db, firstL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('does not construct a work item for PO.DAAC Concise when the first item fails', async function () {
            const currentWorkItems = (await getWorkItemsByJobId(db, firstL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(4);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('does not construct a work item for PO.DAAC Concise when the second item finishes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, firstL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(4);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('constructs a single PO.DAAC Concise work item when the last item succeeds', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const currentWorkItems = (await getWorkItemsByJobId(db, firstL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('sets the status to COMPLETE_WITH_ERRORS when the PO.DAAC Concise request completes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);


            const { job } = await Job.byJobID(db, firstL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
            expect(job.progress).to.equal(100);
          });

          it('includes the error details in the job status', async function () {
            const response = await jobStatus(this.frontend, { jobID: firstL2SSItem.jobID, username: 'joe' });
            const job = JSON.parse(response.text);
            const { errors } = job;
            expect(errors.length).to.equal(1);
            expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
            expect(errors[0].message).to.include('failed with an unknown error');
          });
        });
      });

      describe('when making a request for 3 granules with 2 batches and one fails in the middle while in progress', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 3, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        let batchSizeStub;
        before(async function () {
          batchSizeStub = stub(env, 'maxBatchInputs').get(() => 1);
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
          const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(3);
        });
        after(function () {
          batchSizeStub.restore();
        });

        describe('when the first PO.DAAC L2SS service work item succeeds', function () {
          it('constructs a work item for PO.DAAC Concise', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });
        });

        describe('when the second PO.DAAC L2SS service work item fails', function () {
          let secondL2SSItem;
          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              secondL2SSItem = JSON.parse(res.text).workItem;
              secondL2SSItem.status = WorkItemStatus.FAILED;
              secondL2SSItem.results = [];

              await updateWorkItem(this.backend, secondL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, secondL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('changes the job status to running_with_errors', async function () {
            const { job } = await Job.byJobID(db, secondL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('does not construct another PO.DAAC Concise work item', async function () {
            const currentWorkItems = (await getWorkItemsByJobId(db, secondL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('constructs a second PO.DAAC Concise work item when the last item succeeds', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const currentWorkItems = (await getWorkItemsByJobId(db, secondL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(6);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('leaves the status as RUNNING_WITH_ERRORS when the first PO.DAAC Concise request completes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const { job } = await Job.byJobID(db, secondL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('sets the status to COMPLETE_WITH_ERRORS when the second PO.DAAC Concise request completes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const { job } = await Job.byJobID(db, secondL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
            expect(job.progress).to.equal(100);
          });

          it('includes the error details in the job status', async function () {
            const response = await jobStatus(this.frontend, { jobID: secondL2SSItem.jobID, username: 'joe' });
            const job = JSON.parse(response.text);
            const { errors } = job;
            expect(errors.length).to.equal(1);
            expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
            expect(errors[0].message).to.include('failed with an unknown error');
          });
        });
      });

      describe('when making a request for 3 granules with 2 batches and the last one of the first chain fails', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 3, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        let batchSizeStub;
        before(async function () {
          batchSizeStub = stub(env, 'maxBatchInputs').get(() => 1);
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
          const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(3);
        });
        after(function () {
          batchSizeStub.restore();
        });

        describe('when the first PO.DAAC L2SS service work item succeeds', function () {
          it('constructs a work item for PO.DAAC Concise', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });
        });

        describe('when the second PO.DAAC L2SS service work item succeeds', function () {
          it('constructs a work item for PO.DAAC Concise', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(6);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
          });
        });

        describe('when the last PO.DAAC L2SS service work item fails', function () {
          let lastL2SSItem;
          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              lastL2SSItem = JSON.parse(res.text).workItem;
              lastL2SSItem.status = WorkItemStatus.FAILED;
              lastL2SSItem.results = [];

              await updateWorkItem(this.backend, lastL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, lastL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('changes the job status to running_with_errors', async function () {
            const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('does not construct another PO.DAAC Concise work item', async function () {
            const currentWorkItems = (await getWorkItemsByJobId(db, lastL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(6);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('leaves the status as RUNNING_WITH_ERRORS when the first PO.DAAC Concise request completes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('sets the status to COMPLETE_WITH_ERRORS when the second PO.DAAC Concise request completes', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
            expect(job.progress).to.equal(100);
          });

          it('includes the error details in the job status', async function () {
            const response = await jobStatus(this.frontend, { jobID: lastL2SSItem.jobID, username: 'joe' });
            const job = JSON.parse(response.text);
            const { errors } = job;
            expect(errors.length).to.equal(1);
            expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
            expect(errors[0].message).to.include('failed with an unknown error');
          });
        });
      });

      describe('when making a request for 3 granules with 2 batches and one item fails prior to aggregation and one aggregation item fails', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 3, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        let batchSizeStub;
        before(async function () {
          batchSizeStub = stub(env, 'maxBatchInputs').get(() => 1);
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
          const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(3);
        });
        after(function () {
          batchSizeStub.restore();
        });

        describe('when the first PO.DAAC L2SS service work item succeeds', function () {
          it('constructs a work item for PO.DAAC Concise', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });
        });

        describe('when the second PO.DAAC L2SS service work item succeeds', function () {
          it('constructs a work item for PO.DAAC Concise', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(6);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
          });
        });

        describe('when the last PO.DAAC L2SS service work item fails', function () {
          let lastL2SSItem;
          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              lastL2SSItem = JSON.parse(res.text).workItem;
              lastL2SSItem.status = WorkItemStatus.FAILED;
              lastL2SSItem.results = [];

              await updateWorkItem(this.backend, lastL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, lastL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('changes the job status to running_with_errors', async function () {
            const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('does not construct another PO.DAAC Concise work item', async function () {
            const currentWorkItems = (await getWorkItemsByJobId(db, lastL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(6);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/concise:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });

          it('leaves the status as RUNNING_WITH_ERRORS when the first PO.DAAC Concise request completes successfully', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);

            const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          describe('when the second PO.DAAC Concise request fails', async function () {
            before(async function () {
              let shouldLoop = true;
              // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
              while (shouldLoop) {
                const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
                const lastConciseItem = JSON.parse(res.text).workItem;
                lastConciseItem.status = WorkItemStatus.FAILED;
                lastConciseItem.results = [];
                lastConciseItem.errorMessage = 'batch failed';

                await updateWorkItem(this.backend, lastConciseItem);

                // check to see if the work-item has failed completely
                const workItem = await getWorkItemById(db, lastConciseItem.id);
                shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
              }
            });
            it('sets the status to COMPLETE_WITH_ERRORS', async function () {
              const { job } = await Job.byJobID(db, lastL2SSItem.jobID);
              expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
              expect(job.progress).to.equal(100);
            });
            it('includes both of the error details in the job status', async function () {
              const response = await jobStatus(this.frontend, { jobID: lastL2SSItem.jobID, username: 'joe' });
              const job = JSON.parse(response.text);
              const { errors } = job;
              expect(errors.length).to.equal(2);
              expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
              expect(errors[0].message).to.include('failed with an unknown error');
              expect(errors[1].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
              expect(errors[1].message).to.include('batch failed');
            });
          });
        });
      });

      describe('when making a request for 4 granules with max allowed errors of 1 and two fail', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 4, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        let maxErrorsStub;
        before(async function () {
          maxErrorsStub = stub(env, 'maxErrorsForJob').get(() => 1);
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).to.equal(4);
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

          const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(5);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(4);
        });
        after(function () {
          maxErrorsStub.restore();
        });

        describe('when the first granule completes successfully', function () {
          let firstSwathItem;

          before(async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');

            firstSwathItem = JSON.parse(res.text).workItem;
            firstSwathItem.status = WorkItemStatus.SUCCESSFUL;
            firstSwathItem.results = [getStacLocation(firstSwathItem, 'catalog.json')];
            await fakeServiceStacOutput(firstSwathItem.jobID, firstSwathItem.id);
            await updateWorkItem(this.backend, firstSwathItem);
          });

          it('leaves the job in the running state', async function () {
            const { job } = await Job.byJobID(db, firstSwathItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING);
          });
        });

        describe('when the second PO.DAAC L2SS service work item fails (first failure)', function () {
          let secondL2SSItem;

          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              secondL2SSItem = JSON.parse(res.text).workItem;
              secondL2SSItem.status = WorkItemStatus.FAILED;
              secondL2SSItem.results = [];

              await updateWorkItem(this.backend, secondL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, secondL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('changes the job status to running_with_errors', async function () {
            const { job } = await Job.byJobID(db, secondL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
          });

          it('does not queue a Concise step for the work item that failed', async function () {
            const currentWorkItems = (await getWorkItemsByJobId(db, secondL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });
        });

        describe('when the third PO.DAAC L2SS service work item fails resulting in a (second failure) for the job', function () {
          let thirdL2SSItem;

          before(async function () {
            let shouldLoop = true;
            // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
            while (shouldLoop) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              thirdL2SSItem = JSON.parse(res.text).workItem;
              thirdL2SSItem.status = WorkItemStatus.FAILED;
              thirdL2SSItem.results = [];
              thirdL2SSItem.errorMessage = 'Did not reach 88 MPH.';

              await updateWorkItem(this.backend, thirdL2SSItem);

              // check to see if the work-item has failed completely
              const workItem = await getWorkItemById(db, thirdL2SSItem.id);
              shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
            }
          });

          it('puts the job in a FAILED state', async function () {
            const { job } = await Job.byJobID(db, thirdL2SSItem.jobID);
            expect(job.status).to.equal(JobStatus.FAILED);
          });

          it('includes the error details in the job status', async function () {
            const response = await jobStatus(this.frontend, { jobID: thirdL2SSItem.jobID, username: 'joe' });
            const job = JSON.parse(response.text);
            const { errors } = job;
            expect(errors.length).to.equal(2);
            expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
            expect(errors[0].message).to.include('failed with an unknown error');
            expect(errors[1].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
            expect(errors[1].message).to.include('Did not reach 88 MPH');
          });

          it('marks any remaining work items as canceled', async function () {
            // job failure should trigger cancellation of any pending work items
            const currentWorkItems = (await getWorkItemsByJobId(db, thirdL2SSItem.jobID)).workItems;
            expect(currentWorkItems.length).to.equal(5);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(2);
            expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'ghcr.io/podaac/l2ss-py:sit').length).to.equal(1);
          });
        });
      });

      describe('when making a request for 4 granules and query-cmr fails', function () {
        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: { ...l2ssAndConciseQuery, ...{ maxResults: 4, concatenate: true, ignoreErrors: true } } });
        hookRedirect('joe');

        before(async function () {
          let shouldLoop = true;
          let workItem: WorkItem;
          // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
          while (shouldLoop) {
            const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
            workItem = JSON.parse(res.text).workItem as WorkItem;
            workItem.status = WorkItemStatus.FAILED;
            workItem.results = [];
            workItem.errorMessage = 'Bad scroll session';
            await updateWorkItem(this.backend, workItem);
            // check to see if the work-item has failed completely
            workItem = await getWorkItemById(db, workItem.id);
            shouldLoop = workItem.status != WorkItemStatus.FAILED;
          }

          this.workItem = workItem;
        });

        it('marks the work items as failed', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, this.workItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        });

        it('marks the job as failed', async function () {
          const { job } = await Job.byJobID(db, this.workItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
        });
      });
    });
  });

  describe('when not setting ignoreErrors and using the default behavior', function () {
    describe('when making a request for 3 granules and one fails while in progress', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 3 } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
      });

      describe('when the first Swath Projector work item fails', function () {
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

        it('changes the job status to running_with_errors', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
        });

        it('does not queue a zarr step for the work item that failed', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, firstSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
        });

        it('sets the status to COMPLETE_WITH_ERRORS when the other granules complete', async function () {
          const res1 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          const res2 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-swath-projector:latest');
          const workItem1 = JSON.parse(res1.text).workItem;
          const workItem2 = JSON.parse(res2.text).workItem;

          workItem1.status = WorkItemStatus.SUCCESSFUL;
          workItem1.results = [getStacLocation(workItem1, 'catalog.json')];
          await fakeServiceStacOutput(workItem1.jobID, workItem1.id);
          await updateWorkItem(this.backend, workItem1);

          workItem2.status = WorkItemStatus.SUCCESSFUL;
          workItem2.results = [getStacLocation(workItem2, 'catalog.json')];
          await fakeServiceStacOutput(workItem2.jobID, workItem2.id);
          await updateWorkItem(this.backend, workItem2);

          const res3 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');
          const res4 = await getWorkForService(this.backend, 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest');

          const workItem3 = JSON.parse(res3.text).workItem;
          const workItem4 = JSON.parse(res4.text).workItem;

          workItem3.status = WorkItemStatus.SUCCESSFUL;
          workItem3.results = [getStacLocation(workItem3, 'catalog.json')];
          await fakeServiceStacOutput(workItem3.jobID, workItem3.id);
          await updateWorkItem(this.backend, workItem3);

          workItem4.status = WorkItemStatus.SUCCESSFUL;
          workItem4.results = [getStacLocation(workItem4, 'catalog.json')];
          await fakeServiceStacOutput(workItem4.jobID, workItem4.id);
          await updateWorkItem(this.backend, workItem4);

          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          console.log(JSON.stringify(job.status));
          expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
          expect(job.progress).to.equal(100);
        });

        it('includes the error details in the job status', async function () {
          const response = await jobStatus(this.frontend, { jobID: firstSwathItem.jobID, username: 'joe' });
          const job = JSON.parse(response.text);
          const { errors } = job;
          expect(errors.length).to.equal(1);
          expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
          expect(errors[0].message).to.include('failed with an unknown error');
        });
      });
    });
  });

  describe('when setting ignoreErrors=false', function () {
    describe('when making a request for 3 granules and one fails while in progress', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 3, ignoreErrors: false } } });
      hookRedirect('joe');

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
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
        const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => [WorkItemStatus.READY, WorkItemStatus.QUEUED].includes(item.status) && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(3);
      });

      describe('when the first Swath Projector work item fails', function () {
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

        it('changes the job status to failed', async function () {
          const { job } = await Job.byJobID(db, firstSwathItem.jobID);
          expect(job.status).to.equal(JobStatus.FAILED);
        });

        it('does not queue a zarr step for the work item that failed', async function () {
          const currentWorkItems = (await getWorkItemsByJobId(db, firstSwathItem.jobID)).workItems;
          expect(currentWorkItems.length).to.equal(4);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(2);
          expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'ghcr.io/nasa/harmony-swath-projector:latest').length).to.equal(1);
        });


        it('includes the error details in the job status', async function () {
          const response = await jobStatus(this.frontend, { jobID: firstSwathItem.jobID, username: 'joe' });
          const job = JSON.parse(response.text);
          const { errors } = job;
          expect(errors.length).to.equal(1);
          expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
          expect(errors[0].message).to.include('failed with an unknown error');
        });
      });
    });
  });
});
