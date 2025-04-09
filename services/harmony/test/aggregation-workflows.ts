import { expect } from 'chai';
import { stub } from 'sinon';

import { JobStatus } from '../app/models/job';
import { populateUserWorkFromWorkItems } from '../app/models/user-work';
import { getStacLocation, WorkItemRecord, WorkItemStatus } from '../app/models/work-item-interface';
import * as aggregationBatch from '../app/util/aggregation-batch';
import db from '../app/util/db';
import env from '../app/util/env';
import { defaultObjectStore } from '../app/util/object-store';
import { truncateAll } from './helpers/db';
import { buildJob, getFirstJob } from './helpers/jobs';
import { resetQueues } from './helpers/queue';
import hookServersStartStop from './helpers/servers';
import {
  buildWorkItem, fakeServiceStacOutput, getWorkForService, updateWorkItem,
} from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';

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
    savedWorkItem.outputItemSizes = [1];
    await fakeServiceStacOutput(savedWorkItem.jobID, savedWorkItem.id);
    await updateWorkItem(context.backend, savedWorkItem);
  }

  /**
 * Fail some fake work and update the work item
 * @param context - 'this' from test
 */
  async function failWorkAndUpdateStatus(context: Mocha.Context): Promise<void> {
    const savedWorkItemResp = await getWorkForService(context.backend, 'foo');
    const savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
    savedWorkItem.status = WorkItemStatus.FAILED;
    await updateWorkItem(context.backend, savedWorkItem);
  }

  let nextStepWorkResponse;

  const aggregateService = 'bar';
  hookServersStartStop();

  let sizeOfObjectStub;
  before(function () {
    sizeOfObjectStub = stub(aggregationBatch, 'sizeOfObject')
      .callsFake(async (_) => 7000000000);
  });

  after(function () {
    sizeOfObjectStub.restore();
  });

  beforeEach(async function () {
    resetQueues();
    const job = buildJob({ ignoreErrors: true });
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

    await populateUserWorkFromWorkItems(db);
  });

  this.afterEach(async function () {
    await truncateAll();
    resetQueues();
    nextStepWorkResponse = null;
  });

  describe('and it has fewer granules than the paging threshold', async function () {

    describe('and the first work item for the first step is completed successfully', async function () {
      beforeEach(async function () {
        await doWorkAndUpdateStatus(this);
      });

      it('does not supply work for the next step', async function () {
        nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
        expect(nextStepWorkResponse.statusCode).to.equal(404);
      });

      describe('and the last work item for the first step is completed successfully', async function () {

        this.beforeEach(async function () {
          await doWorkAndUpdateStatus(this);
          nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
        });

        it('supplies exactly one work item for the next step', async function () {
          expect(nextStepWorkResponse.statusCode).to.equal(200);
          const secondNextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(secondNextStepWorkResponse.statusCode).to.equal(404);

        });

        it('provides all the outputs of the preceding step to the aggregating step', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          const items = catalog.links.filter(link => link.rel === 'item');
          expect(items.length).to.equal(2); // <<=== both items
        });

        it('does not add paging links to the catalog', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          expect(catalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });

      });

      describe('and the last work item for the first step fails', async function () {
        let retryLimit;

        before(async function () {
          retryLimit = env.workItemRetryLimit;
          env.workItemRetryLimit = 0;
        });

        after(async function () {
          env.workItemRetryLimit = retryLimit;
        });

        this.beforeEach(async function () {
          await failWorkAndUpdateStatus(this);
          nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
        });

        it('supplies exactly one work item for the next step', async function () {

          // one work item available
          expect(nextStepWorkResponse.statusCode).to.equal(200);

          const secondNextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(secondNextStepWorkResponse.statusCode).to.equal(404);

        });

        it('provides only the successful output of the preceding step to the aggregating step', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          const items = catalog.links.filter(link => link.rel === 'item');
          expect(items.length).to.equal(1); // <<=== just the successful item
        });

        it('does not add paging links to the catalog', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          expect(catalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });

      });
    });

    describe('and the first work item for the first step fails', async function () {
      let retryLimit;
      before(async function () {
        retryLimit = env.workItemRetryLimit;
        env.workItemRetryLimit = 0;
      });

      after(async function () {
        env.workItemRetryLimit = retryLimit;
      });

      beforeEach(async function () {
        await failWorkAndUpdateStatus(this);
      });

      it('does not supply work for the next step', async function () {
        nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
        expect(nextStepWorkResponse.statusCode).to.equal(404);
      });

      describe('and the last work item for the first step is completed successfully', async function () {
        beforeEach(async function () {
          await doWorkAndUpdateStatus(this);
          nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
        });

        it('supplies exactly one work item for the next step', async function () {
          // one work item available
          expect(nextStepWorkResponse.statusCode).to.equal(200);

          const secondNextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(secondNextStepWorkResponse.statusCode).to.equal(404);

        });

        it('provides only the successful output of the preceding step to the aggregating step', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          const items = catalog.links.filter(link => link.rel === 'item');
          expect(items.length).to.equal(1); // <<=== just the successful item
        });

        it('does not add paging links to the catalog', async function () {
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          expect(catalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });

      });

      describe('and the last work item for the first step fails', async function () {
        it('does not supply work for the next step', async function () {
          await failWorkAndUpdateStatus(this);
          nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          expect(nextStepWorkResponse.statusCode).to.equal(404);
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
      beforeEach(async function () {
        await doWorkAndUpdateStatus(this);
      });

      describe('and it is the last work item for the step', async function () {

        it('adds paging links to the catalogs', async function () {
          await doWorkAndUpdateStatus(this);

          nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          // first catalog just has 'next' link
          expect(catalog.links.filter(link => link.rel == 'prev').length).to.equal(0);
          const nextLinks = catalog.links.filter(link => link.rel == 'next');
          expect(nextLinks.length).to.equal(1);
          // second catalog just has 'prev' link
          const nextCatalogPath = nextLinks[0].href;
          const nextCatalog = JSON.parse(await defaultObjectStore().getObject(nextCatalogPath));
          expect(nextCatalog.links.filter(link => link.rel == 'prev').length).to.equal(1);
          expect(nextCatalog.links.filter(link => link.rel == 'next').length).to.equal(0);
        });
      });
    });
  });
});

describe('When a workflow has an aggregating step in the middle and end and starts with a sequential step', async function () {

  let savedWorkItem;
  let nonAggregateWorkItem1;
  let nonAggregateWorkItem2;

  hookServersStartStop();
  const queryCmr = 'harmonyservices/query-cmr:stable';
  const firstAggregateService = 'batchee';
  const secondAggregateService = 'concise';
  const nonAggregateService = 'stitchee';
  let cmrMaxPageSize;

  before(async function () {
    // eslint-disable-next-line prefer-destructuring
    cmrMaxPageSize = env.cmrMaxPageSize;
    env.cmrMaxPageSize = 2;

    resetQueues();
    const job = buildJob({ numInputGranules: 4 });
    await job.save(db);
    this.job = job;
    this.jobID = job.jobID;

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: queryCmr,
      stepIndex: 1,
      workItemCount: 2,
      is_sequential: true,
    }).save(db);

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: firstAggregateService,
      stepIndex: 2,
      hasAggregatedOutput: true,
    }).save(db);

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: nonAggregateService,
      stepIndex: 3,
    }).save(db);

    await buildWorkflowStep({
      jobID: job.jobID,
      serviceID: secondAggregateService,
      stepIndex: 4,
      hasAggregatedOutput: true,
    }).save(db);

    await buildWorkItem({
      jobID: job.jobID,
      serviceID: queryCmr,
      workflowStepIndex: 1,
    }).save(db);

    await populateUserWorkFromWorkItems(db);
  });

  after(async function () {
    await truncateAll();
    env.cmrMaxPageSize = cmrMaxPageSize;
    resetQueues();
  });

  describe('when the first query-cmr completes', async function () {
    before(async function () {
      const savedWorkItemResp = await getWorkForService(this.backend, queryCmr);
      savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
      savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
      savedWorkItem.results = [
        getStacLocation(savedWorkItem, 'catalog0.json'),
        getStacLocation(savedWorkItem, 'catalog1.json'),
      ];
      savedWorkItem.outputItemSizes = [1, 1];
      await fakeServiceStacOutput(this.job.jobID, savedWorkItem.id, 2);
      await updateWorkItem(this.backend, savedWorkItem);
    });

    describe('and the first aggregating service looks for work', async function () {
      it('finds no work', async function () {
        const savedWorkItemResp = await getWorkForService(this.backend, firstAggregateService);
        expect(savedWorkItemResp.statusCode).to.equal(404);
      });
    });

    describe('when the second query-cmr completes', async function () {
      describe('and the first aggregating service looks for work', async function () {
        it('finds work', async function () {
          let savedWorkItemResp = await getWorkForService(this.backend, queryCmr);
          savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
          savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
          savedWorkItem.results = [
            getStacLocation(savedWorkItem, 'catalog0.json'),
            getStacLocation(savedWorkItem, 'catalog1.json'),
          ];
          savedWorkItem.outputItemSizes = [1, 1];
          await fakeServiceStacOutput(this.job.jobID, savedWorkItem.id, 2);
          await updateWorkItem(this.backend, savedWorkItem);

          savedWorkItemResp = await getWorkForService(this.backend, firstAggregateService);
          expect(savedWorkItemResp.statusCode).to.equal(200);
          savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
        });

        describe('when the first aggregating service completes', function () {
          describe('and the non-aggregating service looks for work', async function () {
            it('finds two work-items', async function () {
              savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
              savedWorkItem.results = [
                getStacLocation(savedWorkItem, 'catalog0.json'),
                getStacLocation(savedWorkItem, 'catalog1.json'),
              ];
              savedWorkItem.outputItemSizes = [2, 2];
              await fakeServiceStacOutput(this.job.jobID, savedWorkItem.id, 2);
              await updateWorkItem(this.backend, savedWorkItem);

              const savedWorkItemResp1 = await getWorkForService(this.backend, nonAggregateService);
              expect(savedWorkItemResp1.statusCode).to.equal(200);
              nonAggregateWorkItem1 = JSON.parse(savedWorkItemResp1.text).workItem;

              const savedWorkItemResp2 = await getWorkForService(this.backend, nonAggregateService);
              expect(savedWorkItemResp2.statusCode).to.equal(200);
              nonAggregateWorkItem2 = JSON.parse(savedWorkItemResp2.text).workItem;
            });

            describe('when the non-aggregating service completes', async function () {
              describe('and the second aggregating service looks for work', async function () {
                it('finds work', async function () {
                  nonAggregateWorkItem1.status = WorkItemStatus.SUCCESSFUL;
                  nonAggregateWorkItem1.results = [
                    getStacLocation(nonAggregateWorkItem1, 'catalog0.json'),
                    getStacLocation(nonAggregateWorkItem1, 'catalog1.json'),
                  ];
                  nonAggregateWorkItem1.outputItemSizes = [2, 2];
                  await fakeServiceStacOutput(this.job.jobID, nonAggregateWorkItem1.id, 2);
                  await updateWorkItem(this.backend, nonAggregateWorkItem1);

                  nonAggregateWorkItem2.status = WorkItemStatus.SUCCESSFUL;
                  nonAggregateWorkItem2.results = [
                    getStacLocation(nonAggregateWorkItem2, 'catalog0.json'),
                    getStacLocation(nonAggregateWorkItem2, 'catalog1.json'),
                  ];
                  nonAggregateWorkItem2.outputItemSizes = [2, 2];
                  await fakeServiceStacOutput(this.job.jobID, nonAggregateWorkItem2.id, 2);
                  await updateWorkItem(this.backend, nonAggregateWorkItem2);

                  const savedWorkItemResp = await getWorkForService(this.backend, secondAggregateService);

                  savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;

                  expect(savedWorkItemResp.statusCode).to.equal(200);
                });

                describe('when the second aggregating service completes its work', async function () {

                  it('completes the job', async function () {
                    savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
                    savedWorkItem.results = [
                      getStacLocation(savedWorkItem, 'catalog.json'),
                    ];
                    savedWorkItem.outputItemSizes = [1];
                    await fakeServiceStacOutput(this.job.jobID, savedWorkItem.id);
                    await updateWorkItem(this.backend, savedWorkItem);

                    const job = await getFirstJob(db);
                    expect(job.status).to.equal(JobStatus.SUCCESSFUL);
                  });
                });
              });
            });
          });
        });
      });
    });

  });

});


