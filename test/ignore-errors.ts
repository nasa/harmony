// import { expect } from 'chai';
// import { getWorkItemsByJobId } from '../app/models/work-item';
// import db from '../app/util/db';
// import { Job, JobStatus } from '../app/models/job';
// import { hookClearScrollSessionExpect, hookRedirect } from './helpers/hooks';
// import { hookRangesetRequest } from './helpers/ogc-api-coverages';
// import hookServersStartStop from './helpers/servers';
// import { getWorkForService, updateWorkItem } from './helpers/work-items';
// import { WorkItemStatus } from '../app/models/work-item-interface';

// describe('when setting ignoreErrors=true', function () {
//   const collection = 'C1233800302-EEDTEST';
//   hookServersStartStop();

//   describe('when making a request for a single granule and one of its work items fails', function () {
//     const reprojectAndZarrQuery = {
//       maxResults: 1,
//       outputCrs: 'EPSG:4326',
//       interpolation: 'near',
//       scaleExtent: '0,2500000.3,1500000,3300000',
//       scaleSize: '1.1,2',
//       format: 'application/x-zarr',
//       ignoreErrors: true,
//     };

//     hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
//     hookRedirect('joe');
//     hookClearScrollSessionExpect();

//     before(async function () {
//       const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
//       const { workItem, maxCmrGranules } = JSON.parse(res.text);
//       expect(maxCmrGranules).to.equal(1);
//       workItem.status = WorkItemStatus.SUCCESSFUL;
//       workItem.results = [
//         'test/resources/worker-response-sample/catalog0.json',
//       ];
//       await updateWorkItem(this.backend, workItem);
//       // since there were multiple query cmr results,
//       // multiple work items should be generated for the next step
//       const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
//       expect(currentWorkItems.length).to.equal(2);
//       expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
//     });

//     describe('when the first swot-reprojection service work item fails', function () {
//       let firstSwotItem;

//       before(async function () {
//         const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
//         firstSwotItem = JSON.parse(res.text).workItem;
//         firstSwotItem.status = WorkItemStatus.FAILED;
//         firstSwotItem.results = [];
//         await updateWorkItem(this.backend, firstSwotItem);
//       });

//       it('fails the job', async function () {
//         // work item failure should trigger job failure
//         const job = await Job.byJobID(db, firstSwotItem.jobID);
//         expect(job.status).to.equal(JobStatus.FAILED);
//         // job failure should trigger cancellation of any pending work items
//         const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
//         expect(currentWorkItems.length).to.equal(2);
//         expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
//         expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
//       });

//       it('does not find any further swot-reproject work', async function () {
//         const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
//         expect(res.status).to.equal(404);
//       });

//       it('does not allow any further work item updates', async function () {
//         firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
//         const res = await updateWorkItem(this.backend, firstSwotItem);
//         expect(res.status).to.equal(409);
//       });
//     });
//   });

//   describe('when making a request for 3 granules and one fails while in progress', function () {
//     const reprojectAndZarrQuery = {
//       maxResults: 3,
//       outputCrs: 'EPSG:4326',
//       interpolation: 'near',
//       scaleExtent: '0,2500000.3,1500000,3300000',
//       scaleSize: '1.1,2',
//       format: 'application/x-zarr',
//       ignoreErrors: true,
//       concatenate: false,
//     };

//     hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
//     hookRedirect('joe');
//     hookClearScrollSessionExpect();

//     before(async function () {
//       const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
//       const { workItem, maxCmrGranules } = JSON.parse(res.text);
//       expect(maxCmrGranules).to.equal(3);
//       workItem.status = WorkItemStatus.SUCCESSFUL;
//       workItem.results = [
//         'test/resources/worker-response-sample/catalog0.json',
//         'test/resources/worker-response-sample/catalog1.json',
//         'test/resources/worker-response-sample/catalog2.json',
//       ];
//       await updateWorkItem(this.backend, workItem);
//       // since there were multiple query cmr results,
//       // multiple work items should be generated for the next step
//       const currentWorkItems = (await getWorkItemsByJobId(db, workItem.jobID)).workItems;
//       expect(currentWorkItems.length).to.equal(4);
//       expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(3);
//     });

//     describe('when the first swot-reprojection service work item fails', function () {
//       let firstSwotItem;

//       before(async function () {
//         const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
//         firstSwotItem = JSON.parse(res.text).workItem;
//         firstSwotItem.status = WorkItemStatus.FAILED;
//         firstSwotItem.results = [];
//         await updateWorkItem(this.backend, firstSwotItem);
//       });

//       it('leaves the job in the running state', async function () {
//         // work item failure should trigger job failure
//         const job = await Job.byJobID(db, firstSwotItem.jobID);
//         expect(job.status).to.equal(JobStatus.RUNNING);
//       });

//       it('does not queue a zarr step for the work item that failed', async function () {
//         // job failure should trigger cancellation of any pending work items
//         const currentWorkItems = (await getWorkItemsByJobId(db, firstSwotItem.jobID)).workItems;
//         expect(currentWorkItems.length).to.equal(4);
//         expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
//         expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.READY && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
//         expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
//       });

//       it('sets the status to COMPLETE_WITH_ERRORS when the other granules complete', async function () {
//         const res1 = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
//         const res2 = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
//         const workItem1 = JSON.parse(res1.text).workItem;
//         const workItem2 = JSON.parse(res2.text).workItem;

//         workItem1.status = WorkItemStatus.SUCCESSFUL;
//         workItem1.results = ['test/resources/worker-response-sample/catalog0.json'];
//         await updateWorkItem(this.backend, workItem1);

//         workItem2.status = WorkItemStatus.SUCCESSFUL;
//         workItem2.results = ['test/resources/worker-response-sample/catalog0.json'];
//         await updateWorkItem(this.backend, workItem2);

//         const res3 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
//         const res4 = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');

//         const workItem3 = JSON.parse(res3.text).workItem;
//         const workItem4 = JSON.parse(res4.text).workItem;

//         workItem3.status = WorkItemStatus.SUCCESSFUL;
//         workItem3.results = ['test/resources/worker-response-sample/catalog0.json'];
//         await updateWorkItem(this.backend, workItem3);

//         workItem4.status = WorkItemStatus.SUCCESSFUL;
//         workItem4.results = ['test/resources/worker-response-sample/catalog0.json'];
//         await updateWorkItem(this.backend, workItem4);

//         const job = await Job.byJobID(db, firstSwotItem.jobID);
//         expect(job.status).to.equal(JobStatus.COMPLETE_WITH_ERRORS);
//         expect(job.progress).to.equal(100);
//       });
//     });
//   });
// });