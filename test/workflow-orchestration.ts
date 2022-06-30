import { expect } from 'chai';
import { getWorkItemsByJobId, getWorkItemsByJobIdAndStepIndex } from '../app/models/work-item';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import db from '../app/util/db';
import env from '../app/util/env';
import { Job, JobStatus } from '../app/models/job';
import { hookClearScrollSessionExpect, hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import { buildWorkItem, getWorkForService, hookGetWorkForService, updateWorkItem, fakeServiceStacOutput } from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';
import { buildJob } from './helpers/jobs';
import { getStacLocation, WorkItemRecord, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';
import { getObjectText } from './helpers/object-store';
import { stub } from 'sinon';

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
    it('finds the queued work item, but query-cmr fails to return a catalog for the next work items', async function () {
      const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
      expect(res.status).to.equal(200);
      const { workItem, maxCmrGranules } = JSON.parse(res.text);
      expect(maxCmrGranules).to.equal(2);
      expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:latest');
      workItem.status = WorkItemStatus.SUCCESSFUL;
      workItem.results = [];
      await updateWorkItem(this.backend, workItem);
    });

    describe('when checking the jobs listing', function () {
      it('shows the job as failed with an internal harmony error', async function () {
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.status).to.equal('failed');
        expect(job.message).to.equal('Harmony internal failure: could not create the next work items for the request.');
      });
    });
  });
});

describe('When a workflow contains an aggregating step', async function () {
  /**
   * Do some fake work and update the work item
   * @param context - 'this' from test
   */
  async function doWorkAndUpdateStatus(context: Mocha.Context): Promise<void> {
    const savedWorkItemResp = await getWorkForService(context.backend, 'foo');
    const savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
    savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
    savedWorkItem.results = [
      getStacLocation(savedWorkItem, 'catalog.json'),
    ];
    await fakeServiceStacOutput(savedWorkItem.jobID, savedWorkItem.id);
    await updateWorkItem(context.backend, savedWorkItem);
  }
  const aggregateService = 'bar';
  hookServersStartStop();

  beforeEach(async function () {
    const job = buildJob();
    await job.save(db);
    this.jobID = job.jobID;

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: 'foo',
      stepIndex: 1,
      workItemCount: 2,
    }).save(db);

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: aggregateService,
      stepIndex: 2,
      hasAggregatedOutput: true,
    }).save(db);

    await buildWorkItem({
      jobID: job.jobID,
      serviceID: 'foo',
      workflowStepIndex: 1,
    }).save(db);

    await buildWorkItem({
      jobID: job.jobID,
      serviceID: 'foo',
      workflowStepIndex: 1,
    }).save(db);
    const savedWorkItemResp = await getWorkForService(this.backend, 'foo');
    const savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
    savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
    savedWorkItem.results = [
      getStacLocation(savedWorkItem, 'catalog.json'),
    ];
    await fakeServiceStacOutput(job.jobID, savedWorkItem.id);
    await updateWorkItem(this.backend, savedWorkItem);
  });

  this.afterEach(async function () {
    await db.table('work_items').del();
  });

  describe('and it has fewer granules than the paging threshold', async function () {

    describe('and a work item for the first step is completed', async function () {
      describe('and it is not the last work item for the step', async function () {
        it('does not supply work for the next step', async function () {

          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(nextStepWorkResponse.statusCode).to.equal(404);
        });
      });

      describe('and it is the last work item for the step', async function () {

        it('supplies exactly one work item for the next step', async function () {
          await doWorkAndUpdateStatus(this);

          // one work item available
          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(nextStepWorkResponse.statusCode).to.equal(200);

          const secondNextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(secondNextStepWorkResponse.statusCode).to.equal(404);


        });

        it('provides all the outputs of the preceding step to the aggregating step', async function () {
          await doWorkAndUpdateStatus(this);
          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await getObjectText(filePath));
          const items = catalog.links.filter(link => link.rel === 'item');
          expect(items.length).to.equal(2);
        });

        it('does not add paging links to the catalog', async function () {
          await doWorkAndUpdateStatus(this);

          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await getObjectText(filePath));
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          expect(catalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });
      });
    });
  });

  describe('and it has more granules than the paging threshold', async function () {
    let envStub;

    before(function () {
      envStub = stub(env, 'aggregateStacCatalogMaxPageSize').get(() => 1);
    });

    after(function () {
      envStub.restore();
    });

    describe('and a work item for the first step is completed', async function () {

      describe('and it is the last work item for the step', async function () {

        it('adds paging links to the catalogs', async function () {
          await doWorkAndUpdateStatus(this);

          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await getObjectText(filePath));
          // first catalog just has 'next' link
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          const nextLinks = catalog.links.filter(link => link.rel == 'next');
          expect(nextLinks.length).to.equal(1);
          // second catalog just has 'prev' link
          const nextCatalogPath = nextLinks[0].href;
          const nextCatalog = JSON.parse(await getObjectText(nextCatalogPath));
          expect(nextCatalog.links.filter(link => link.rel == 'prev').length).to.equal(1);
          expect(nextCatalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });
      });
    });
  });
});

describe('Workflow chaining for a collection configured for swot reprojection and netcdf-to-zarr', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();
  describe('when requesting to both reproject and reformat for two granules', function () {
    hookClearScrollSessionExpect();
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

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reprojection using swot reprojection', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('sds/swot-reproject:latest');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('harmonyservices/netcdf-to-zarr:latest');
    });

    it('returns a human-readable message field indicating the request has been limited to a subset of the granules', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.equal('CMR query identified 177 granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults.');
    });

    // Verify it only queues a work item for the query-cmr task
    describe('when checking for a swot reproject work item', function () {
      hookGetWorkForService('sds/swot-reproject:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a netcdf-to-zarr work item', function () {
      hookGetWorkForService('harmonyservices/netcdf-to-zarr:latest');

      it('does not find a work item', async function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when checking for a query-cmr work item', function () {
      it('finds the item and can complete it', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        expect(res.status).to.equal(200);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(2);
        expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:latest');
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [getStacLocation(workItem, 'catalog.json')];
        await fakeServiceStacOutput(workItem.jobID, workItem.id);
        await updateWorkItem(this.backend, workItem);
      });

      describe('when checking to see if swot-reprojection work is queued', function () {
        it('finds a swot-reprojection service work item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
          expect(res.status).to.equal(200);
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [getStacLocation(workItem, 'catalog.json')];
          await fakeServiceStacOutput(workItem.jobID, workItem.id);
          await updateWorkItem(this.backend, workItem);
          expect(workItem.serviceID).to.equal('sds/swot-reproject:latest');
        });

        describe('when checking to see if netcdf-to-zarr work is queued', function () {
          it('finds a netcdf-to-zarr service work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'harmonyservices/netcdf-to-zarr:latest');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('harmonyservices/netcdf-to-zarr:latest');
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as in progress and 50 percent complete because 1 of 2 granules is complete', async function () {
              const jobs = await Job.forUser(db, 'anonymous');
              const job = jobs.data[0];
              expect(job.status).to.equal('running');
              expect(job.progress).to.equal(50);
            });
          });

          describe('when completing all three steps for the second granule', function () {
            it('wish I could do this in the describe', async function () {
              for await (const service of ['harmonyservices/query-cmr:latest', 'sds/swot-reproject:latest', 'harmonyservices/netcdf-to-zarr:latest']) {
                const res = await getWorkForService(this.backend, service);
                const { workItem } = JSON.parse(res.text);
                workItem.status = WorkItemStatus.SUCCESSFUL;
                workItem.results = [getStacLocation(workItem, 'catalog.json')];
                await fakeServiceStacOutput(workItem.jobID, workItem.id);
                await updateWorkItem(this.backend, workItem);
              }
            });

            describe('when checking the jobs listing', function () {
              it('marks the job as successful and progress of 100 with 5 links', async function () {
                const jobs = await Job.forUser(db, 'anonymous');
                const job = jobs.data[0];
                expect(job.status).to.equal('successful');
                expect(job.progress).to.equal(100);
                // 5 links:
                //   1 for s3 access instructions,
                //   2 for the two assets returned from fake sds/swot-reproject:latest response
                //   2 for the two assets returned from fake harmonyservices/netcdf-to-zarr:latest response
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
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
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
      // since there were multiple query cmr results,
      // multiple work items should be generated for the next step
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

      it('fails the job, and all further work items are canceled', async function () {
        // work item failure should trigger job failure
        const job = await Job.byJobID(db, firstSwotItem.jobID);
        expect(job.status === JobStatus.FAILED);
        // job failure should trigger cancellation of any pending work items
        const currentWorkItems = (await getWorkItemsByJobId(db, job.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
      });

      it('does not find any further swot-reproject work', async function () {
        const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
        expect(res.status).to.equal(404);
      });

      it('does not allow any further work item updates', async function () {
        firstSwotItem.status = WorkItemStatus.SUCCESSFUL;
        const res = await await updateWorkItem(this.backend, firstSwotItem);
        expect(res.status).to.equal(409);

        const currentWorkItems = (await getWorkItemsByJobId(db, firstSwotItem.jobID)).workItems;
        expect(currentWorkItems.length).to.equal(4);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.SUCCESSFUL && item.serviceID === 'harmonyservices/query-cmr:latest').length).to.equal(1);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.CANCELED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(2);
        expect(currentWorkItems.filter((item) => item.status === WorkItemStatus.FAILED && item.serviceID === 'sds/swot-reproject:latest').length).to.equal(1);
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

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('harmonyservices/netcdf-to-zarr:latest');
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

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reprojection using swot reprojection', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('sds/swot-reproject:latest');
    });
  });
});

describe('When a request spans multiple CMR pages', function () {
  describe('and contains no aggregating steps', function () {
    const collection = 'C1233800302-EEDTEST';
    hookServersStartStop();
    
    before(async function () {
      // ensure that we're getting only the items 
      // we created  for this test when invoking getWorkForService
      await truncateAll();
    });
    after(async function () {
      await truncateAll();
    });

    describe('when requesting five granules', function () {
      hookClearScrollSessionExpect();
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
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).equals(5);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'), 
            getStacLocation(workItem, 'catalog1.json'), 
            getStacLocation(workItem, 'catalog2.json')];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
          await updateWorkItem(this.backend, workItem);
          // sanity check that 3 swot-reproject items were generated by the first query-cmr task
          const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, workItem.jobID, 2)).workItems.length;
          expect(queuedCount).equals(3);
        });

        it('limits the next query-cmr task based on how many STAC items have already been generated', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).equals(2);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'), 
            getStacLocation(workItem, 'catalog1.json'), 
          ];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
          await updateWorkItem(this.backend, workItem);
          // sanity check that 2 more swot-reproject items were generated by the second query-cmr task
          const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, workItem.jobID, 2)).workItems.length;
          expect(queuedCount).equals(5);
        });

        it('does not generate any more work for query-cmr once the next step work items are generated', async function () {
          const nextStepWorkResponse = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          expect(nextStepWorkResponse.statusCode).to.equal(404);
        });

        it('does not define maxCmrGranules for non-query-cmr items', async function () {
          const res = await getWorkForService(this.backend, 'sds/swot-reproject:latest');
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
  
    before(async function () {
      await truncateAll();

      const job = buildJob({ numInputGranules: 5 });
      await job.save(db);
      this.jobID = job.jobID;
  
      await buildWorkflowStep({
        jobID: job.jobID,
        serviceID: 'harmonyservices/query-cmr:latest',
        stepIndex: 1,
        workItemCount: 2,
      }).save(db);
  
      await buildWorkflowStep({
        jobID: job.jobID,
        serviceID: aggregateService,
        stepIndex: 2,
        workItemCount: 1,
        hasAggregatedOutput: true,
      }).save(db);
  
      await buildWorkItem({
        jobID: job.jobID,
        serviceID: 'harmonyservices/query-cmr:latest',
        workflowStepIndex: 1,
        scrollID: '123abc',
      }).save(db);
    });

    after(async function () {
      await truncateAll();
    });
    
    describe('when checking for a query-cmr work item', function () {
      it('finds a query-cmr item along with a maxCmrGranules limit', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(5);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'), 
          getStacLocation(workItem, 'catalog1.json'), 
          getStacLocation(workItem, 'catalog2.json')];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 3);
        await updateWorkItem(this.backend, workItem);
      });

      it('does not generate the aggregation step until all query-cmr items are finished', async function () {
        const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, this.jobID, 2)).workItems.length;
        expect(queuedCount).equals(0);
      });

      it('limits the next query-cmr task based on how many STAC items have already been generated', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(2);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'), 
          getStacLocation(workItem, 'catalog1.json')];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2);
        await updateWorkItem(this.backend, workItem);
      });

      it('queues the aggregating work item once all query-cmr items are finished', async function () {
        const queuedCount = (await getWorkItemsByJobIdAndStepIndex(db, this.jobID, 2)).workItems.length;
        expect(queuedCount).equals(1);
      });

      it('does not generate any more work for query-cmr once the next step work items are generated', async function () {
        const nextStepWorkResponse = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        expect(nextStepWorkResponse.statusCode).to.equal(404);
      });

      it('does not define maxCmrGranules for non-query-cmr items', async function () {
        const res = await getWorkForService(this.backend, aggregateService);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).equals(undefined);
        expect(workItem).to.not.equal(undefined);
      });
    });
  });  
});
