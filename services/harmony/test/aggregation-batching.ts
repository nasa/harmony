import { it } from 'mocha';
import permutations from 'just-permutations';
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
import WorkItem from '../app/models/work-item';
import { objectStoreForProtocol } from '../app/util/object-store';
import { truncateAll } from './helpers/db';
import { hookServices } from './helpers/stub-service';
import { StacCatalog } from '../app/util/stac';

/**
 * Create a work item update for a query-cmr get work response
 *
 * @param resText - The response text from a query-cmr get work request
 * @param resultCount - The number of catalogs to include in the query-cmr result
 * @returns a work result to be sent to Harmony for the given work request
 */
function createCmrResult(resText: string, resultCount: number): WorkItem {
  const { workItem } = JSON.parse(resText);
  workItem.status = WorkItemStatus.SUCCESSFUL;
  workItem.results = [];
  workItem.outputItemSizes = [];
  for (let i = 0; i < resultCount; i++) {
    workItem.results.push(getStacLocation(workItem, `catalog${i}.json`));
    workItem.outputItemSizes.push(i + 1);
  }

  return workItem;
}

/**
 * Get the item urls for the STAC catalog input to a work item
 *
 * @param workItem - the work item containing the STAC catalog to process
 * @returns - an array of urls for the STAC items in the STAC catalog
 */
async function getBatchItemsForWorkItem(workItem: WorkItem): Promise<String[]> {
  const { stacCatalogLocation } = workItem;
  const s3 = objectStoreForProtocol('s3');
  const catalog = await s3.getObjectJson(stacCatalogLocation) as StacCatalog;
  const itemsHrefs = catalog.links.filter(link => link.rel === 'item').map(item => item.href);
  return itemsHrefs;
}

describe('when testing a batched aggregation service', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  const collection = 'C1243729749-EEDTEST';
  describe('with only one batch that should be created', function () {
    let batchInputsStub;
    before(function () {
      batchInputsStub = stub(env, 'maxBatchInputs').get(() => 3);
    });
    after(function () {
      if (batchInputsStub.restore) {
        batchInputsStub.restore();
      }
    });
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

  describe('with multiple batches due to item counts and global configuration', function () {
    let sizeOfObjectStub;
    let batchInputsStub;
    let pageStub;
    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchInputsStub = stub(env, 'maxBatchInputs').get(() => 3);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 1);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchInputsStub.restore) {
        batchInputsStub.restore();
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

  describe('with multiple batches due to item counts and service configuration', function () {
    let sizeOfObjectStub;
    let batchInputsStub;
    let pageStub;
    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchInputsStub = stub(env, 'maxBatchInputs').get(() => 1_000_000_000);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 1);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchInputsStub.restore) {
        batchInputsStub.restore();
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

      const serviceConfigs = [
        {
          name: 'podaac/concise',
          data_operation_version: '0.17.0',
          type: {
            name: 'turbo',
          },
          collections: [{ id: collection }],
          capabilities: {
            concatenation: true,
          },
          steps: [{
            image: 'harmonyservices/query-cmr:latest',
          }, {
            image: 'ghcr.io/podaac/concise:sit',
            is_batched: true,
            max_batch_inputs: 3,
            operations: ['concatenate'],
          }],
        },
      ];

      hookServices(serviceConfigs);

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
    let sizeOfObjectStub;
    let pageStub;
    let batchSizeStub;

    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchSizeStub = stub(env, 'maxBatchInputs').get(() => 10000);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 3000);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchSizeStub.restore) {
        batchSizeStub.restore();
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
          workItem.outputItemSizes = [3000, 4000];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      // Verify that since only 7000 bytes for items were created from query-cmr it does not yet
      // batch a concise request (can go up to 10000)
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
          workItem.outputItemSizes = [3000, 2000];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      describe('when checking to see if a concise work item is queued now that enough bytes have been generated from query-cmr', function () {
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
          workItem.outputItemSizes = [7000, 2000];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a second concise work item is queued now that another 10k bytes of inputs from query-cmr items have completed', function () {
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
          workItem.outputItemSizes = [10000];
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
            it('finds the final concise work item and can complete it', async function () {
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
          });

          describe('when checking for another concise work item', function () {
            hookGetWorkForService('ghcr.io/podaac/concise:sit');
            it('does not find a work item because all items have been processed', async function () {
              expect(this.res.status).to.equal(404);
            });
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as successful and progress of 100 with 4 links to the three aggregated outputs', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              const dataLinks = job.links.filter(link => link.rel === 'data');
              expect(dataLinks.length).to.equal(4);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches due to service size constraints', function () {
    let sizeOfObjectStub;
    let pageStub;
    let batchSizeStub;

    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchSizeStub = stub(env, 'maxBatchSizeInBytes').get(() => 5_000_000);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 3000);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchSizeStub.restore) {
        batchSizeStub.restore();
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

      const serviceConfigs = [
        {
          name: 'podaac/concise',
          data_operation_version: '0.17.0',
          type: {
            name: 'turbo',
          },
          collections: [{ id: collection }],
          capabilities: {
            concatenation: true,
          },
          steps: [{
            image: 'harmonyservices/query-cmr:latest',
          }, {
            image: 'ghcr.io/podaac/concise:sit',
            is_batched: true,
            max_batch_size_in_bytes: 5,
            operations: ['concatenate'],
          }],
        },
      ];

      hookServices(serviceConfigs);

      hookRangesetRequest('1.0.0', collection, 'all', { query: conciseQuery, username: 'joe' });
      hookRedirect('joe');

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
          workItem.outputItemSizes = [2, 1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      // Verify that since only 3 bytes for items were created from query-cmr it does not yet
      // batch a concise request (limit for this test is 5)
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
          workItem.outputItemSizes = [2, 2];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });
      });

      describe('when checking to see if a concise work item is queued now that enough bytes have been generated from query-cmr', function () {
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
          it('does not find a work item (current batch has 4 bytes, but can hold up to 5)', async function () {
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
          workItem.outputItemSizes = [3, 2];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('when checking to see if a second concise work item is queued now that another 5 bytes of inputs from query-cmr items have completed', function () {
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
            it('does not find a work item (currently have 2 bytes in the batch, but it can hold up to 5)', async function () {
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
          workItem.outputItemSizes = [5];
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
            it('finds the final concise work item and can complete it', async function () {
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
          });

          describe('when checking for another concise work item', function () {
            hookGetWorkForService('ghcr.io/podaac/concise:sit');
            it('does not find a work item because all items have been processed', async function () {
              expect(this.res.status).to.equal(404);
            });
          });

          describe('when checking the jobs listing', function () {
            it('marks the job as successful and progress of 100 with 4 links to the three aggregated outputs', async function () {
              const jobs = await Job.forUser(db, 'joe');
              const job = jobs.data[0];
              expect(job.status).to.equal('successful');
              expect(job.progress).to.equal(100);
              const dataLinks = job.links.filter(link => link.rel === 'data');
              expect(dataLinks.length).to.equal(4);
            });
          });
        });
      });
    });
  });

  describe('with multiple batches in a service chain', function () {
    let sizeOfObjectStub;
    let batchSizeStub;
    let pageStub;
    // this is default work item index order for four work items - we are going to generate all
    // the permutations of this to test all possible finish orders for the l2ss work items
    const workItemIndices = [0, 1, 2, 3];
    const workItemIndexPermuations = permutations(workItemIndices);

    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchSizeStub = stub(env, 'maxBatchInputs').get(() => 2);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 1);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchSizeStub.restore) {
        batchSizeStub.restore();
      }
      if (sizeOfObjectStub.restore) {
        sizeOfObjectStub.restore();
      }
    });
    for (const workItemIndexPermutation of workItemIndexPermuations) {
      describe('when submitting a request for l2ss-concise', function () {
        const l2ssCollection = 'C1234208438-POCLOUD';
        const l2ssConciseQuery = {
          subset: 'lat(0:90)',
          concatenate: true,
          maxResults: 4,
        };

        before(async function () {
          await truncateAll();
        });

        hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: l2ssConciseQuery, username: 'joe' });
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

        it('then requests subsetting using l2ss', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/l2ss-py:sit');
        });

        it('then requests aggregation using concise', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps[2].serviceID).to.equal('ghcr.io/podaac/concise:sit');
        });
      });

      describe('when the query-cmr service has run', async function () {
        it('gets and updates work for query-cmr', async function () {
          let res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          expect(res.status).to.equal(200);
          let workItem = createCmrResult(res.text, 2);
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);

          res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
          expect(res.status).to.equal(200);
          workItem = createCmrResult(res.text, 2);
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);
          await updateWorkItem(this.backend, workItem);
        });

        describe('and the l2ss work items are available', async function () {
          const l2ssWorkItems: WorkItem[] = [];
          const expectedBatches = [[], []];
          before(async function () {
            for (let i = 0; i < 4; i++) {
              const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
              const { workItem } = JSON.parse(res.text);
              l2ssWorkItems.push(workItem);
              const { jobID, id } = workItem;
              const batchIndex = Math.floor(i / 2);
              const stacItemUrl = `s3://local-artifact-bucket/${jobID}/${id}/outputs/granule.json`;
              expectedBatches[batchIndex].push(stacItemUrl);
            }
          });
          describe('and the l2ss work items finish in random order', async function () {
            it('generates the same batches regardless of the order', async function () {
              for (const index of workItemIndexPermutation) {
                const workItem = l2ssWorkItems[index];
                workItem.status = WorkItemStatus.SUCCESSFUL;
                workItem.results = [getStacLocation(workItem, 'catalog.json')];
                workItem.outputItemSizes = [1];
                await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
                await updateWorkItem(this.backend, workItem);
              }
              const conciseWorkRequestResponse1 =
                await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
              const conciseWorkItem1 = JSON.parse(conciseWorkRequestResponse1.text).workItem;
              const conciseWorkRequestResponse2 =
                await getWorkForService(this.backend, 'ghcr.io/podaac/concise:sit');
              const conciseWorkItem2 = JSON.parse(conciseWorkRequestResponse2.text).workItem;
              const batch1 = await getBatchItemsForWorkItem(conciseWorkItem1);
              expect(new Set(batch1)).to.eql(new Set(expectedBatches[0]));
              const batch2 = await getBatchItemsForWorkItem(conciseWorkItem2);
              expect(new Set(batch2)).to.eql(new Set(expectedBatches[1]));
            });
          });
        });
      });
    }
  });

  describe('with maxResults=1 in a service chain', function () {
    let sizeOfObjectStub;
    let batchSizeStub;
    let pageStub;

    before(function () {
      pageStub = stub(env, 'cmrMaxPageSize').get(() => 2);
      batchSizeStub = stub(env, 'maxBatchInputs').get(() => 2);
      sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
        .callsFake(async (_) => 1);
    });
    after(function () {
      if (pageStub.restore) {
        pageStub.restore();
      }
      if (batchSizeStub.restore) {
        batchSizeStub.restore();
      }
      if (sizeOfObjectStub.restore) {
        sizeOfObjectStub.restore();
      }
    });

    describe('when submitting a request for l2ss-concise', function () {
      const l2ssCollection = 'C1234208438-POCLOUD';
      const l2ssConciseQuery = {
        subset: 'lat(0:90)',
        concatenate: true,
        maxResults: 1,
        forceAsync: true,
      };

      before(async function () {
        await truncateAll();
      });

      hookRangesetRequest('1.0.0', l2ssCollection, 'all', { query: l2ssConciseQuery, username: 'joe' });
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

      it('then requests subsetting using l2ss', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].serviceID).to.equal('ghcr.io/podaac/l2ss-py:sit');
      });

      it('then requests aggregation using concise', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[2].serviceID).to.equal('ghcr.io/podaac/concise:sit');
      });

    });
    describe('when checking for a query-cmr work item', function () {
      it('finds the item and can complete it', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        expect(res.status).to.equal(200);
        const { workItem, maxCmrGranules } = JSON.parse(res.text);
        expect(maxCmrGranules).to.equal(1);
        expect(workItem.serviceID).to.equal('harmonyservices/query-cmr:latest');
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
          getStacLocation(workItem, 'catalog0.json'),
        ];
        workItem.outputItemSizes = [1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1, true);
        await updateWorkItem(this.backend, workItem);
      });
    });

    describe('when checking to see if an l2ss-py work item is queued', function () {
      it('finds an l2ss-py work item and can complete it', async function () {
        const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
        expect(res.status).to.equal(200);
        const { workItem } = JSON.parse(res.text);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [getStacLocation(workItem, 'catalog.json')];
        workItem.outputItemSizes = [1];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
        await updateWorkItem(this.backend, workItem);
        expect(workItem.serviceID).to.equal('ghcr.io/podaac/l2ss-py:sit');
      });
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
    });
  });
});
