import { expect } from 'chai';
import { stub } from 'sinon';
import { getWorkItemsByJobId } from '../app/models/work-item';
import db from '../app/util/db';
import { Job, JobStatus } from '../app/models/job';
import { hookClearScrollSessionExpect, hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import { fakeServiceStacOutput, getWorkForService, updateWorkItem } from './helpers/work-items';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';
import env from '../app/util/env';
import { jobStatus } from './helpers/jobs';

const reprojectAndZarrQuery = {
  maxResults: 1,
  outputCrs: 'EPSG:4326',
  interpolation: 'near',
  scaleExtent: '0,2500000.3,1500000,3300000',
  scaleSize: '1.1,2',
  format: 'application/x-zarr',
  ignoreErrors: true,
  concatenate: false,
};

describe('when setting ignoreErrors=true', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('when making a request for a single granule and it completes successfully', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 1 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(1);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [
        getStacLocation(workItem, 'catalog0.json'),
      ];
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
      await updateWorkItem(this.backend, workItem);
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(2);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
    });

    describe('when all of the work items succeed', function () {
      let firstSwotItem;
      let zarrItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        firstSwotItem = JSON.parse(res.text).workItem;
        firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
        firstSwotItem.results = [
          getStacLocation(firstSwotItem, 'catalog.json'),
        ];
        await fakeServiceStacOutput(firstSwotItem.jobID, firstSwotItem.id);
        await updateWorkItem(this.backend, firstSwotItem);

        const res2 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
        zarrItem = JSON.parse(res2.text).workItem;
        zarrItem.status = WorkItemStatus.SUCCESSFUL;
        zarrItem.results = [
          getStacLocation(zarrItem, 'catalog.json'),
        ];
        await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
        await updateWorkItem(this.backend, zarrItem);
      });

      it('marks the job as successful', async function () {
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.SUCCESSFUL);
        expect(job.progress).to.equal(100);
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(3);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/netcdf-to-zarr:latest').length).to.equal(1);
      });

      it('does not find any further swot-reproject work', async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        expect(res.status).to.equal(404);
      });

    });
  });

  describe('when making a request for a single granule and one of its work items fails', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 1 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(1);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [
        getStacLocation(workItem, 'catalog0.json'),
      ];
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 1);
      await updateWorkItem(this.backend, workItem);
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(2);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
    });

    describe('when the first swot-reprojection service work item fails', function () {
      let firstSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        firstSwotItem = JSON.parse(res.text).workItem;
        firstSwotItem.status = WorkItemStatus.FAILED;
        firstSwotItem.results = [];
        await updateWorkItem(this.backend, firstSwotItem);
      });

      it('fails the job', async function () {
        // work item failure with only one granue should trigger job failure
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
      });

      it('does not find any further swot-reproject work', async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        expect(res.status).to.equal(404);
      });

      it('does not allow any further work item updates', async function () {
        firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
        const res = await updateWorkItem(this.backend, firstSwotItem);
        expect(res.status).to.equal(409);
      });
    });
  });

  describe('when making a request for two granules and both of the granules have one work item fail', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 2 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(2);
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [
        getStacLocation(workItem, 'catalog0.json'),
        getStacLocation(workItem, 'catalog1.json'),
      ];
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
      await updateWorkItem(this.backend, workItem);
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;

      expect(currentWorkItems.length).to.equal(3);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
    });

    describe('when the first swot-reprojection service work item fails', function () {
      let firstSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        firstSwotItem = JSON.parse(res.text).workItem;
        firstSwotItem.status = WorkItemStatus.FAILED;
        firstSwotItem.results = [];
        await updateWorkItem(this.backend, firstSwotItem);
      });

      it('changes the job status to running_with_errors', async function () {
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(3);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
      });
    });

    describe('when the second swot-reprojection service item succeeds and then its zarr work item fails', function () {
      let secondSwotItem;
      let zarrItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        secondSwotItem = JSON.parse(res.text).workItem;
        secondSwotItem.status = WorkItemStatus.SUCCESSFUL;
        secondSwotItem.results = [getStacLocation(secondSwotItem, 'catalog.json')];
        await fakeServiceStacOutput(secondSwotItem.jobID, secondSwotItem.id);
        await updateWorkItem(this.backend, secondSwotItem);

        const res2 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
        zarrItem = JSON.parse(res2.text).workItem;
        zarrItem.status = WorkItemStatus.FAILED;
        zarrItem.results = [];
        await updateWorkItem(this.backend, zarrItem);
      });

      it('marks the job as failed', async function () {
        // all work items failing should trigger job failure
        const job = await Job.byJobID(db, secondSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/netcdf-to-zarr:latest').length).to.equal(1);
      });
    });
  });

  describe('when making a request for 3 granules and one fails while in progress', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 3 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

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
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
      await updateWorkItem(this.backend, workItem);
      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(4);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(3);
    });

    describe('when the first swot-reprojection service work item fails', function () {
      let firstSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        firstSwotItem = JSON.parse(res.text).workItem;
        firstSwotItem.status = WorkItemStatus.FAILED;
        firstSwotItem.results = [];
        await updateWorkItem(this.backend, firstSwotItem);
      });

      it('changes the job status to running_with_errors', async function () {
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
      });

      it('does not queue a zarr step for the work item that failed', async function () {
        const currentWorkItems = (await getWorkItemsByJobId(db, firstSwotItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
      });

      it('sets the status to COMPLETE_WITH_ERRORS when the other granules complete', async function () {
        const res1 = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        const res2 = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
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

        const res3 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
        const res4 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');

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

        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
        expect(job.progress).to.equal(100);
      });

      it('includes the error details in the job status', async function () {
        const response = await jobStatus(this.frontend, { jobID: firstSwotItem.jobID, username: 'joe' });
        const job = JSON.parse(response.text);
        const { errors } = job;
        expect(errors.length).to.equal(1);
        expect(errors[0].url).to.equal('https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc');
        expect(errors[0].message).to.include('failed with an unknown error');
      });
    });
  });

  describe('when making a request for 4 granules with max allowed errors of 1 and two fail', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 4 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

    before(async function () {
      stub(env, 'maxErrorsForJob').get(() => 1);
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
      await fakeServiceStacOutput(workItem.jobID, workItem.id, 4);
      await updateWorkItem(this.backend, workItem);

      const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(5);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(4);
    });

    describe('when the first granule completes successfully', function () {
      let firstSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');

        firstSwotItem = JSON.parse(res.text).workItem;
        firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
        firstSwotItem.results = [getStacLocation(firstSwotItem, 'catalog.json')];
        await fakeServiceStacOutput(firstSwotItem.jobID, firstSwotItem.id);
        await updateWorkItem(this.backend, firstSwotItem);

        const res2 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
        const zarrItem = JSON.parse(res2.text).workItem;
        zarrItem.status = WorkItemStatus.SUCCESSFUL;
        zarrItem.results = [getStacLocation(zarrItem, 'catalog.json')];
        await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
        await updateWorkItem(this.backend, zarrItem);
      });

      it('leaves the job in the running state', async function () {
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.RUNNING);
      });
    });

    describe('when the second swot-reprojection service work item fails (first failure)', function () {
      let secondSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');

        secondSwotItem = JSON.parse(res.text).workItem;
        secondSwotItem.status = WorkItemStatus.FAILED;
        secondSwotItem.results = [];
        await updateWorkItem(this.backend, secondSwotItem);
      });

      it('changes the job status to running_with_errors', async function () {
        const job = await Job.byJobID(db, secondSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
      });

      it('does not queue a zarr step for the work item that failed', async function () {
        const currentWorkItems = (await getWorkItemsByJobId(db, secondSwotItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(6);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/netcdf-to-zarr:latest').length).to.equal(1);

      });
    });

    describe('when the third swot-reprojection service work item fails resulting in a (second failure) for the job', function () {
      let thirdSwotItem;

      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        thirdSwotItem = JSON.parse(res.text).workItem;
        thirdSwotItem.status = WorkItemStatus.FAILED;
        thirdSwotItem.results = [];
        thirdSwotItem.errorMessage = 'Did not reach 88 MPH.';
        await updateWorkItem(this.backend, thirdSwotItem);
      });

      it('puts the job in a FAILED state', async function () {
        const job = await Job.byJobID(db, thirdSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });

      it('includes the error details in the job status', async function () {
        const response = await jobStatus(this.frontend, { jobID: thirdSwotItem.jobID, username: 'joe' });
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
        const currentWorkItems = (await getWorkItemsByJobId(db, thirdSwotItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(6);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/netcdf-to-zarr:latest').length).to.equal(1);
      });
    });
  });

  describe('when making a request for 4 granules and query-cmr fails', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 4 } } });
    hookRedirect('joe');
    hookClearScrollSessionExpect();

    before(async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
      const { workItem } = JSON.parse(res.text);
      workItem.status = WorkItemStatus.FAILED;
      workItem.results = [];
      workItem.errorMessage = 'Bad scroll session';
      await updateWorkItem(this.backend, workItem);
      this.workItem = workItem;
    });

    it('marks the work items as failed', async function () {
      const currentWorkItems = (await getWorkItemsByJobId(db, this.workItem.jobID)).workItems;
      expect(currentWorkItems.length).to.equal(1);
      expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
    });

    it('marks the job as failed', async function () {
      const job = await Job.byJobID(db, this.workItem.jobID);
      expect(job.status).to.equal(JobStatus.FAILED);
    });
  });

  describe('When a request spans multiple CMR pages', function () {
    hookClearScrollSessionExpect();
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery, ...{ maxResults: 5 } } });
    hookRedirect('joe');

    describe('when completing the first query-cmr work item', function () {

      let workItemJobID;

      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem } = JSON.parse(res.text);
        workItemJobID = workItem.jobID;
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
          getStacLocation(workItem, 'catalog1.json'),
          getStacLocation(workItem, 'catalog1.json'),
        ];
        await updateWorkItem(this.backend, workItem);
      });

      it('queues 3 swot-reproject work items and 1 more query-cmr work item', async function () {
        const currentWorkItems = (await getWorkItemsByJobId(db, workItemJobID)).workItems;
        expect(currentWorkItems.length).to.equal(5);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(3);
      });

      it('leaves the job in the running state', async function () {
        const job = await Job.byJobID(db, workItemJobID);
        expect(job.status).to.equal(JobStatus.RUNNING);
      });

      describe('when the first granule swot-reproject and netcdf-to-zarr work items succeed', async function () {
        let firstSwotItem;

        before(async function () {
          const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');

          firstSwotItem = JSON.parse(res.text).workItem;
          firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
          firstSwotItem.results = [getStacLocation(firstSwotItem, 'catalog.json')];
          await fakeServiceStacOutput(firstSwotItem.jobID, firstSwotItem.id);
          await updateWorkItem(this.backend, firstSwotItem);

          const res2 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
          const zarrItem = JSON.parse(res2.text).workItem;
          zarrItem.status = WorkItemStatus.SUCCESSFUL;
          zarrItem.results = [getStacLocation(zarrItem, 'catalog.json')];
          await fakeServiceStacOutput(zarrItem.jobID, zarrItem.id);
          await updateWorkItem(this.backend, zarrItem);
        });

        it('leaves the job in the running state', async function () {
          const job = await Job.byJobID(db, firstSwotItem.jobID);
          expect(job.status).to.equal(JobStatus.RUNNING);
        });
      });
    });

    describe('when the next swot-reproject item fails', function () {
      let secondSwotItem;
      before(async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');

        secondSwotItem = JSON.parse(res.text).workItem;
        secondSwotItem.status = WorkItemStatus.FAILED;
        secondSwotItem.results = [];
        await updateWorkItem(this.backend, secondSwotItem);
      });

      it('updates the job to the running_with_errors state', async function () {
        const job = await Job.byJobID(db, secondSwotItem.jobID);
        expect(job.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
      });
    });

    describe('when the next query-cmr work item fails', function () {
      let secondQueryCmrItem;
      before(async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');

        secondQueryCmrItem = JSON.parse(res.text).workItem;
        secondQueryCmrItem.status = WorkItemStatus.FAILED;
        secondQueryCmrItem.results = [];
        await updateWorkItem(this.backend, secondQueryCmrItem);
      });

      it('updates the job to the failed state', async function () {
        const job = await Job.byJobID(db, secondQueryCmrItem.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });

      it('cancels any remaining work items', async function () {
        const currentWorkItems = (await getWorkItemsByJobId(db, secondQueryCmrItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(6);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/netcdf-to-zarr:latest').length).to.equal(1);
      });
    });
  });

});