import { describe } from 'mocha';
import { expect } from 'chai';
import MockDate from 'mockdate';
import { buildJob } from './helpers/jobs';
import { Job, JobStatus } from '../../harmony/app/models/job';
import WorkItem, { getWorkItemsByJobId } from '../../harmony/app/models/work-item';
import { hookTransaction, truncateAll } from './helpers/db';
import { buildWorkItem } from './helpers/work-items';
import db from '../../harmony/app/util/db';
import WorkFailer from '../app/workers/failer';
import { WorkItemStatus } from '../../harmony/app/models/work-item-interface';
import env from '../../harmony/app/util/env';
import { buildWorkflowStep } from './helpers/workflow-steps';
import { hookGetQueueForType } from '../../harmony/test/helpers/queue';

const workFailer = new WorkFailer();

// 11 hours -- any RUNNING items that haven't been updatedAt for this long should get picked up
// by the WorkFailer
const failDurationMinutes = 11 * 60;

describe('WorkFailer', function () {
  let retryLimit: number;

  // WorkItem initial createAt/updatedAt dates
  // (which should determine which items get picked up
  // by the WorkFailer)
  const oldDate = '1/1/2000'; // "old" work items will get created on this date
  const newDate = '1/30/2000'; // "new" work items will get created on this date

  // declare these up here in order to access
  // them in "it" block scopes
  const twoOldJob = buildJob({ status: JobStatus.RUNNING });
  const oneOldJob = buildJob({ status: JobStatus.RUNNING, ignoreErrors: true });
  let noneOldJob: Job;
  let readyItemJob: Job;
  let readyItemJobItem2: WorkItem;

  hookTransaction();
  hookGetQueueForType();

  before(async function () {
    // Set the limit to something small for these tests
    retryLimit = env.workItemRetryLimit;
    env.workItemRetryLimit = 3;

    // this job has two "old" RUNNING work items
    // (they will have been running for a while by the time the WorkFailer is triggered)
    await twoOldJob.save(this.trx);
    MockDate.set(oldDate);
    const twoOldJobItem1 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await twoOldJobItem1.save(this.trx);
    const twoOldJobItem2 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await twoOldJobItem2.save(this.trx);
    await buildWorkflowStep({ jobID: twoOldJob.jobID, stepIndex: 0 }).save(this.trx);
    MockDate.reset();

    // this job has 1 (out of 2) old work items (both RUNNING), and ignoreErrors: true
    await oneOldJob.save(this.trx);
    MockDate.set(newDate);
    const oneOldJobItem1 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await oneOldJobItem1.save(this.trx);
    MockDate.set(oldDate);
    const oneOldJobItem2 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await oneOldJobItem2.save(this.trx);
    await buildWorkflowStep({ jobID: oneOldJobItem2.jobID, stepIndex: 0 }).save(this.trx);
    MockDate.reset();

    // this job has 0 old work items
    noneOldJob = buildJob({ status: JobStatus.RUNNING });
    await noneOldJob.save(this.trx);
    MockDate.set(newDate);
    const noneOldJobItem1 = buildWorkItem({ jobID: noneOldJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await noneOldJobItem1.save(this.trx);
    await buildWorkflowStep({ jobID: noneOldJobItem1.jobID, stepIndex: 0 }).save(this.trx);

    // this job has an old work item in the READY state and a new one in the RUNNING state
    readyItemJob = buildJob({ status: JobStatus.RUNNING });
    await readyItemJob.save(this.trx);
    MockDate.set(newDate);
    const readyItemJobItem1 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, startedAt: new Date() });
    await readyItemJobItem1.save(this.trx);
    MockDate.set(oldDate);
    readyItemJobItem2 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.READY, workflowStepIndex: 0 });
    await readyItemJobItem2.save(this.trx);
    await buildWorkflowStep({ jobID: readyItemJobItem2.jobID, stepIndex: 0 }).save(this.trx);

    await this.trx.commit();
    MockDate.reset();
  });

  after(async function () {
    await truncateAll();
    MockDate.reset();
    env.workItemRetryLimit = retryLimit;
  });

  describe('.handleWorkItemUpdates', async function () {
    let oldItems = [];
    it('proccesses work item updates for items that are RUNNING and have not been updated for the specified duration', async function () {
      MockDate.set('1/2/2000'); // some items should now be a day old
      await workFailer.handleWorkItemUpdates(failDurationMinutes, 1);

      // check that both old items were re-queued
      const twoOldJobItems = (await getWorkItemsByJobId(db, twoOldJob.jobID)).workItems;
      expect(twoOldJobItems.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(2);
      expect(twoOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(2);

      // check that only the one old item was re-queued
      const oneOldJobItems = (await getWorkItemsByJobId(db, oneOldJob.jobID)).workItems;
      expect(oneOldJobItems.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.status === WorkItemStatus.RUNNING).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.retryCount === 0).length).to.equal(1);

      oldItems = twoOldJobItems;
      oldItems = oldItems.concat(oneOldJobItems.filter((item) => item.status === WorkItemStatus.READY));
    });

    it('does not proccess old work items that are in the READY state', async function () {
      // check that the old READY item is unchanged
      const readyItemJobItems = (await getWorkItemsByJobId(db, readyItemJob.jobID)).workItems;
      const readyItem = readyItemJobItems.filter((item) => item.status === WorkItemStatus.READY)[0];
      expect(readyItem.id === readyItemJobItem2.id);
    });

    it('does not proccess jobs without long-running work items', async function () {
      const noneOldJobItems = (await getWorkItemsByJobId(db, noneOldJob.jobID)).workItems;
      expect(noneOldJobItems.filter((item) => item.status === WorkItemStatus.RUNNING).length).to.equal(1);
      expect(noneOldJobItems.filter((item) => item.retryCount === 0).length).to.equal(1);
    });

    // This continues the tests from above,
    // simulating items being picked up by services and the work failer
    [
      // twoOldJob
      [twoOldJob, 2, '1/2/2000', '1/3/2000', [WorkItemStatus.READY, WorkItemStatus.READY], 2, JobStatus.RUNNING],
      [twoOldJob, 3, '1/3/2000', '1/4/2000', [WorkItemStatus.READY, WorkItemStatus.READY], 2,  JobStatus.RUNNING],
      [twoOldJob, 3, '1/4/2000', '1/5/2000', [WorkItemStatus.FAILED, WorkItemStatus.CANCELED], 2, JobStatus.FAILED],
      // oneOldJob
      [oneOldJob, 2, '1/2/2000', '1/3/2000', [WorkItemStatus.READY, WorkItemStatus.READY], 1, JobStatus.RUNNING],
      [oneOldJob, 3, '1/3/2000', '1/4/2000', [WorkItemStatus.READY, WorkItemStatus.READY], 1, JobStatus.RUNNING],
      [oneOldJob, 3, '1/4/2000', '1/5/2000', [WorkItemStatus.FAILED, WorkItemStatus.CANCELED], 1, JobStatus.COMPLETE_WITH_ERRORS],
    ].forEach(async ([
      job,
      retryCount, // The expected retry count for the work items after the work failer runs
      runningDate, // The mock date that will be used for when the items started RUNNING again
      failerDate, // The mock date that the work failer will run
      workItemStatuses, // The item statuses that we expect after the work failer runs
      numItemUpdates,  // The number of work items that we expect to be processed on each invocation of the work failer
      jobStatus, // The job status that we expect to see after the work failer runs
    ]:
    [Job, number, string, string, WorkItemStatus[], number, JobStatus]) => {
      it(`keeps processing updates for old items, triggering retries until exhausted (running date: ${runningDate}, jobID: ${job.jobID})`, async () => {
        // simulate that job's old items are RUNNING again
        MockDate.set(runningDate);
        let items = (await getWorkItemsByJobId(db, job.jobID)).workItems;

        for (const item of items) {
          if (!oldItems.map(i => {return i.id;}).includes(item.id)) {
            // only simulating for the "old" items as specified in the before hook
            continue;
          }
          item.status = WorkItemStatus.RUNNING;
          await item.save(db);
        }

        // advance by a day so that job's WorkItems will
        // have been running for a whole day and should get picked up again by the WorkFailer
        MockDate.set(failerDate);

        await workFailer.handleWorkItemUpdates(failDurationMinutes, 1);

        items = (await getWorkItemsByJobId(db, job.jobID)).workItems;

        // check that the item retry count was updated appropriately
        expect(items.filter((item) => item.retryCount === retryCount).length).to.equal(numItemUpdates);

        // check that the item status was updated appropriately
        workItemStatuses.forEach((status) => {
          const index = items.findIndex((item) => item.status === status);
          expect(index > -1);
          items.splice(index, 1); // 2nd parameter means remove one item only
        });

        // check that the job status was appropriately updated as a result of the item updates
        const response = await Job.byJobID(db, job.jobID);
        expect(response.job.status === jobStatus);
      });
    });
  });
});
