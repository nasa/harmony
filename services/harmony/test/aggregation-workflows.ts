import { expect } from 'chai';
import db from '../app/util/db';
import env from '../app/util/env';
import { JobStatus } from '../app/models/job';
import { getFirstJob } from './helpers/jobs';
import hookServersStartStop from './helpers/servers';
import { buildWorkItem, getWorkForService, updateWorkItem, fakeServiceStacOutput } from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';
import * as aggregationBatch from '../app/util/aggregation-batch';
import { buildJob } from './helpers/jobs';
import { getStacLocation, WorkItemRecord, WorkItemStatus } from '../app/models/work-item-interface';
import { hookTransaction, truncateAll } from './helpers/db';
import { stub } from 'sinon';
import { populateUserWorkFromWorkItems } from '../app/models/user-work';
import { resetQueues } from './helpers/queue';
import { defaultObjectStore } from '../app/util/object-store';

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

    await populateUserWorkFromWorkItems(db);
    const savedWorkItemResp = await getWorkForService(this.backend, 'foo');
    const savedWorkItem = JSON.parse(savedWorkItemResp.text).workItem;
    savedWorkItem.status = WorkItemStatus.SUCCESSFUL;
    savedWorkItem.results = [
      getStacLocation(savedWorkItem, 'catalog.json'),
    ];
    savedWorkItem.outputItemSizes = [1];
    await fakeServiceStacOutput(job.jobID, savedWorkItem.id);
    await updateWorkItem(this.backend, savedWorkItem);
  });

  this.afterEach(async function () {
    await truncateAll();
    resetQueues();
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
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
          const items = catalog.links.filter(link => link.rel === 'item');
          expect(items.length).to.equal(2);
        });

        it('does not add paging links to the catalog', async function () {
          await doWorkAndUpdateStatus(this);

          const nextStepWorkResponse = await getWorkForService(this.backend, aggregateService);
          const workItem = JSON.parse(nextStepWorkResponse.text).workItem as WorkItemRecord;
          const filePath = workItem.stacCatalogLocation;
          const catalog = JSON.parse(await defaultObjectStore().getObject(filePath));
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
  const queryCmr = 'harmonyservices/query-cmr:latest';
  const firstAggregateService = 'batchee';
  const secondAggregateService = 'concise';
  const nonAggregateService = 'stitchee';
  let cmrMaxPageSize;

  before(async function () {
    cmrMaxPageSize = env.cmrMaxPageSize;
    env.cmrMaxPageSize = 2

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
                    ]
                    savedWorkItem.outputItemSizes = [1];
                    await fakeServiceStacOutput(this.job.jobID, savedWorkItem.id);
                    await updateWorkItem(this.backend, savedWorkItem);

                    const job = await getFirstJob(db);
                    expect(job.status).to.equal(JobStatus.SUCCESSFUL);
                  })
                })
              })
            })
          })
        });
      });
    });

  });

});
