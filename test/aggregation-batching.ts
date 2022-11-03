import { stub } from 'sinon';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import db from '../app/util/db';
import env from '../app/util/env';
import hookServersStartStop from './helpers/servers';
import { fakeServiceStacOutput, getWorkForService, hookGetWorkForService, updateWorkItem } from './helpers/work-items';
import * as aggregationBatch from '../app/util/aggregation-batch';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import { hookRedirect } from './helpers/hooks';
import { expect } from 'chai';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import { Job } from '../app/models/job';

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
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a concise work item is queued', function () {
          it('finds a concise work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as successful and progress of 100 with 1 link to the aggregated output', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              const dataLinks = job.links.filter(link => link.rel === 'data');
              expect(dataLinks.length).to.equal(1);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches due to item counts and service configuration', function () {
    let sizeOfObjectStub;
    let pageStub;
    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 1);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (sizeOfObjectStub.restore) {
        sizeOfObjectStub.restore();
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

      describe('when first checking for a query-cmr work item', function () {
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
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      // Verify that since only 2 items were created from query-cmr it does not yet batch a concise request (need 3)
      describe('when checking for a concise work item', function () {
        hookGetWorkForService('ghcr.io/podaac/concise:sit');
        it('does not find a work item', async function () {
          expect(this.res.status).to.equal(404);
        });
      });

      describe('when checking for a query-cmr work item for the second time', function () {
        it('finds the second item and can complete it', async function () {
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
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      describe('when checking to see if a concise work item is queued now that four inputs have been generated from query-cmr', function () {
        it('finds the first concise work item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
          expect(res.status).to.equal(200);
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [getStacLocation(workItem, 'catalog.json')];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
          expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
        });

        describe('when checking for a second concise work item', function () {
          hookGetWorkForService('ghcr.io/podaac/concise:sit');
          it('does not find a work item (currently have 4, but need 6 inputs from query-cmr before the second concise batch)', async function () {
            expect(this.res.status).to.equal(404);
          });
        });

        describe('when checking the jobs listing', function () {
          it('lists the job as running and progress of 43 with 1 link to the first aggregated output', async function () {
            const jobs = await Job.forUser(db, 'joe');
            const job = jobs.data[0];
            expect(job.status).to.equal('running');
            expect(job.progress).to.equal(50);
            const dataLinks = job.links.filter(link => link.rel === 'data');
            expect(dataLinks.length).to.equal(1);
          });
        });
      });

      describe('when checking for a query-cmr work item for the third time', function () {
        it('finds the third item and can complete it', async function () {
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
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a second concise work item is queued now that 6 inputs from query-cmr items have completed', function () {
          it('finds the second concise work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
          });

          describe('when checking for a third concise work item', function () {
            hookGetWorkForService('ghcr.io/podaac/concise:sit');
            it('does not find a work item (currently have 6, but need 7 inputs from query-cmr before the third concise batch)', async function () {
              expect(this.res.status).to.equal(404);
            });
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as running and progress of 86 with 2 links to the first two aggregated outputs', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('running');
              expect(job.progress).to.equal(66);
              const dataLinks = job.links.filter(link => link.rel === 'data');
              expect(dataLinks.length).to.equal(2);
            });
          });
        });
      });

      describe('when checking for a query-cmr work item for the fourth time', function () {
        it('finds the fourth item and can complete it', async function () {
          const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          expect(res.status).to.equal(200);
          const { workItem, maxCmrGranules } = JSON.parse(res.text);
          expect(maxCmrGranules).to.equal(1);
          expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:latest');
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
            getStacLocation(workItem, 'catalog.json'),
          ];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking for another query-cmr work item', function () {
          hookGetWorkForService('harmonyservices/query-cmr:latest');
          it('does not find a work item since all inputs have been received', async function () {
            expect(this.res.status).to.equal(404);
          });
        });

        describe('when checking to see if a third concise work item is queued now that all 7 inputs from query-cmr items have completed', function () {
          it('finds the third concise work item and can complete it', async function () {
            const res = await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
            expect(res.status).to.equal(200);
            const { workItem } = JSON.parse(res.text);
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = [getStacLocation(workItem, 'catalog.json')];
            workItem.outputItemSizes = [1];
            await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
            await updateWorkItem(this.backend, workItem);
            expect(workItem.serviceID).to.equal('ghcr.io/podaac/concise:sit');
          });

          describe('when checking for another concise work item', function () {
            hookGetWorkForService('ghcr.io/podaac/concise:sit');
            it('does not find a work item because all items have been processed', async function () {
              expect(this.res.status).to.equal(404);
            });
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as successful and progress of 100 with 3 links to the three aggregated outputs', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              const dataLinks = job.links.filter(link => link.rel === 'data');
              expect(dataLinks.length).to.equal(3);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches due to global size constraints', function () {

  });

  // TODO HARMONY-1279
  describe('with multiple batches with items completing out of sorted order', function () {

  });

});