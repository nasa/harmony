import { stub } from 'sinon';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import db from '../app/util/db';
import env from '../app/util/env';
import hookServersStartStop from './helpers/servers';
import { fakeServiceStacOutput, getWorkForService, hookGetWorkForService, updateWorkItem } from './helpers/work-items';

import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import { hookRedirect } from './helpers/hooks';
import { expect } from 'chai';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import { Job } from '../app/models/job';

// import { truncateAll } from './helpers/db';
// import { buildJob } from './helpers/jobs';
// import { buildWorkflowStep } from './helpers/workflow-steps';
// /**
//  * Constructs the job, workflow steps, and initial work item for the test
//  *
//  * @param itemCount - the number of work items for the initial step
//  * @param chainOfServices - An array of services in the order they will be chained
//  */
// async function setupJobAndWorkflowSteps(
//   itemCount: number, chainOfServices: { name: string, aggregated?: boolean }[],
// ): Promise<string> {
//   const job = buildJob({ numInputGranules: itemCount });
//   await job.save(db);
//   this.jobID = job.jobID;

//   let i = 0;
//   for (const service of chainOfServices) {
//     i += 1;
//     await buildWorkflowStep({
//       jobID: job.jobID,
//       serviceID: service.name,
//       hasAggregatedOutput: Boolean(service.aggregated),
//       stepIndex: i,
//       workItemCount: itemCount,
//     }).save(db);
//   }

//   await buildWorkItem({
//     jobID: job.jobID,
//     serviceID: chainOfServices[0].name,
//     workflowStepIndex: 1,
//   }).save(db);
//   return job.jobID;
// }

// /**
//  * Do some fake work and update the work item
//  * @param context - 'this' from test
//  */
// async function doWorkAndUpdateStatus(context: Mocha.Context, serviceName, sizes: number[]): Promise<void> {
//   const savedWorkItemResp = await getWorkForService(context.backend, serviceName);
//   const savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
//   savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
//   savedWorkItem.results = [];
//   savedWorkItem.outputItemSizes = [];
//   let i = 0;
//   while (i < sizes.length) {
//     savedWorkItem.results.append(getStacLocation(savedWorkItem, `catalog${i}.json`));
//     savedWorkItem.outputItemSizes.append(sizes[i]);
//     i += 1;
//   }
//   await fakeServiceStacOutput(savedWorkItem.jobID, savedWorkItem.id);
//   await updateWorkItem(context.backend, savedWorkItem);
// }

// describe('when submitting a request for a batched aggregation service', function () {
//   hookServersStartStop();
//   describe('with only one batch that should be created', function () {
//     const serviceChain = [{ name: 'foo' }, { name: 'agg', aggregated: true }];
//     beforeEach(async function () {
//       this.jobID = await setupJobAndWorkflowSteps(2, serviceChain);
//     });
//     afterEach(async function () {
//       await truncateAll();
//     });

//     describe('when one work item completes for the first step', function () {
//       it('queues another work item for the first step', async function () {
//         await doWorkAndUpdateStatus(this, 'foo', [1, 1]);
//       });
//     });
//   });

//   describe('with multiple batches due to item counts and service configuration', function () {

//   });

//   describe('with multiple batches due to global size constraints', function () {

//   });

//   describe('with multiple batches with items completing out of sorted order', function () {

//   });

// });
// describe('when testing a batched aggregation service', function () {
//   // const collection = 'C1233800302-EEDTEST';
//   const collection = 'C1234208438-POCLOUD';
//   hookServersStartStop({ skipEarthdataLogin: false });
//   const reprojectAndZarrQuery = {
//     maxResults: 2,
//     // outputCrs: 'EPSG:4326',
//     // interpolation: 'near',
//     // scaleExtent: '0,2500000.3,1500000,3300000',
//     // scaleSize: '1.1,2',
//     // format: 'application/x-zarr',
//     concatenate: true, // Aggregated workflows are tested below
//   };

//   hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery, username: 'joe' });
//   hookRedirect('joe');

//   it('generates a workflow with 3 steps', async function () {
//     console.log(this.res.text);
//     const job = JSON.parse(this.res.text);
//     const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

//     expect(workflowSteps.length).to.equal(3);
//   });
// });


describe('when testing a batched aggregation service', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  const collection = 'C1243729749-EEDTEST';
  describe('with only one batch that should be created', function () {
    describe('when submitting a request for concise', function () {
      const conciseQuery = {
        maxResults: 2,
        concatenate: true,
      };

      hookRangesetRequest('1.0.0', collection, 'all', { query: conciseQuery, username: 'joe' });
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

      it('then requests aggregation using concise', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/concise:sit');
      });

      it('has the number of input granules set to 2', function () {
        const job = JSON.parse(this.res.text);
        expect(job.numInputGranules).to.equal(2);
      });

      // Verify it only queues a work item for the query-cmr task
      describe('when checking for a concise work item', function () {
        hookGetWorkForService('ghcr.io/podaac/concise:sit');

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
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
          ];
          workItem.outputItemSizes = [1, 2];
          await fakeServiceStacOutput(workItem.jobID, workItem.id);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a concise work item is queued', function () {
          xit('finds a concise work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
          });

          describe('when checking the jobs listing', function () {
            xit('marks the job as successful and progress of 100 with 1 link to the aggregated output', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              expect(job.links.length).to.equal(1);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches due to item counts and service configuration', function () {
    let pageStub;
    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
    });
    describe('when submitting a request for concise', function () {
      const conciseQuery = {
        maxResults: 7,
        concatenate: true,
      };

      hookRangesetRequest('1.0.0', collection, 'all', { query: conciseQuery, username: 'joe' });
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

      it('then requests aggregation using concise', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/concise:sit');
      });

      it('has the number of input granules set to 7', function () {
        const job = JSON.parse(this.res.text);
        expect(job.numInputGranules).to.equal(7);
      });

      // Verify it only queues a work item for the query-cmr task
      describe('when checking for a concise work item', function () {
        hookGetWorkForService('ghcr.io/podaac/concise:sit');

        it('does not find a work item', async function () {
          expect(this.res.status).to.equal(404);
        });
      });

      describe('when checking for a query-cmr work item', function () {
        it('finds the first item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          expect(res.status).to.equal(200);
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).to.equal(2);
          expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:latest');
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
          ];
          workItem.outputItemSizes = [1, 2];
          await fakeServiceStacOutput(workItem.jobID, workItem.id);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a concise work item is queued', function () {
          xit('finds a concise work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
          });

          describe('when checking the jobs listing', function () {
            xit('marks the job as successful and progress of 100 with 1 link to the aggregated output', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              expect(job.links.length).to.equal(1);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches due to global size constraints', function () {

  });

  describe('with multiple batches with items completing out of sorted order', function () {

  });

});