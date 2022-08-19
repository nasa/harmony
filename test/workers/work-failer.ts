import { describe } from 'mocha';
import MockDate from 'mockdate';
import { buildJob } from '../helpers/jobs';
import { Job, JobStatus } from '../../app/models/job';
import WorkItem, { getWorkItemsByJobId } from '../../app/models/work-item';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';
import logger from '../../app/util/log';
import db from '../../app/util/db';
import { expect } from 'chai';
import WorkFailer, { WorkFailerConfig } from '../../app/workers/work-failer';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import env from '../../app/util/env';


const config: WorkFailerConfig = { logger };
const workFailer = new WorkFailer(config);

// 11 hours -- any RUNNING items that haven't been updatedAt for this long should get picked up
// by the WorkFailer and either retried or failed once retries are exhausted
const failDurationMinutes = 11 * 60; 

describe('WorkFailer', function () {
  // we'll trigger the WorkFailer this many times
  let retryLimit: number;

  // WorkItem initial createAt/updatedAt dates
  // (which should determine which items get picked up 
  // by the WorkFailer)
  const oldDate = '1/1/2000'; // "old" work items will get created on this date
  const newDate = '1/5/2000'; // "new" work items will get created on this date

  // declare these up here in order to access
  // them in "it" block scopes
  let twoOldJob: Job;
  let oneOldJob: Job;
  let noneOldJob: Job;
  let readyItemJob: Job;
  let readyItemJobItem2: WorkItem;

  hookTransaction();

  before(async function () {
    // Set the limit to something small for these tests
    retryLimit = env.workItemRetryLimit;
    env.workItemRetryLimit = 3;

    // this job has two "old" RUNNING work items
    // (they will have been running for a while by the time the WorkFailer is triggered)
    twoOldJob = buildJob({ status: JobStatus.RUNNING });
    await twoOldJob.save(this.trx);
    
    MockDate.set(oldDate);
    const twoOldJobItem1 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING });
    await twoOldJobItem1.save(this.trx);
    const twoOldJobItem2 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING });
    await twoOldJobItem2.save(this.trx);
    MockDate.reset();

    // this job has 1 (out of 2) old work items (both RUNNING)
    oneOldJob = buildJob({ status: JobStatus.RUNNING_WITH_ERRORS });
    await oneOldJob.save(this.trx);
    
    MockDate.set(newDate);
    const oneOldJobItem1 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await oneOldJobItem1.save(this.trx);
    
    MockDate.set(oldDate);
    const oneOldJobItem2 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await oneOldJobItem2.save(this.trx);
    MockDate.reset();

    // this job has 0 old work items
    noneOldJob = buildJob({ status: JobStatus.RUNNING });
    await noneOldJob.save(this.trx);
    
    MockDate.set(newDate);
    const noneOldJobItem1 = buildWorkItem({ jobID: noneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await noneOldJobItem1.save(this.trx);

    // this job has an old work item in the READY state and a new one in the RUNNING state
    readyItemJob = buildJob({ status: JobStatus.RUNNING });
    await readyItemJob.save(this.trx);
    
    MockDate.set(newDate);
    const readyItemJobItem1 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.RUNNING });
    await readyItemJobItem1.save(this.trx);

    MockDate.set(oldDate);
    readyItemJobItem2 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.READY });
    await readyItemJobItem2.save(this.trx);
    
    await this.trx.commit();
    MockDate.reset();
  });

  after(async function () {
    await truncateAll();
    MockDate.reset();
    env.workItemRetryLimit = retryLimit;
  });

  describe('.proccessWorkItemUpdates', async function () {
    let initialResponse: {
      workItemIds: number[];
      jobIds: string[];
    };
    it('calls proccessWorkItemUpdates for work items that have been running for too long', async function () {
      MockDate.set('1/2/2000');
      initialResponse = await workFailer.proccessWorkItemUpdates(failDurationMinutes);
      
      const twoOldJobItems = (await getWorkItemsByJobId(this.trx, twoOldJob.jobID)).workItems;
      expect(twoOldJobItems.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(2);
      expect(twoOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(2);

      const oneOldJobItems = (await getWorkItemsByJobId(this.trx, oneOldJob.jobID)).workItems;
      expect(oneOldJobItems.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.status === WorkItemStatus.RUNNING).length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.retryCount === 0).length).to.equal(1);

      expect(initialResponse.jobIds.length).to.equal(2);
      expect(initialResponse.workItemIds.length).to.equal(3);
    });

    it('does not proccess long-running work items in the READY state', async function () {
      const readyItemJobItems = (await getWorkItemsByJobId(this.trx, readyItemJob.jobID)).workItems;
      const readyItem = readyItemJobItems.filter((item) => item.status === WorkItemStatus.READY)[0];
      expect(readyItem.id === readyItemJobItem2.id);
      expect(!initialResponse.jobIds.includes(readyItemJob.jobID));
      expect(!initialResponse.workItemIds.includes(readyItem.id));
    });

    it('does not proccess jobs without long-running work items', async function () {
      expect(!initialResponse.jobIds.includes(noneOldJob.jobID));
      expect(!initialResponse.workItemIds.includes(noneOldJob.id));
    });

    it('should not find any items to proccess upon immediate subsequent invocation', async function () {
      const subsequentResponse = await workFailer.proccessWorkItemUpdates(failDurationMinutes);
      expect(subsequentResponse.jobIds.length).to.equal(0);
      expect(subsequentResponse.workItemIds.length).to.equal(0);
    });

    it('keeps processing long-running items when they are re-queued', async function () {
      // simulate that twoOldJob's items are RUNNING again after the initial re-queuing
      MockDate.set('1/2/2000');
      let twoOldJobItems = (await getWorkItemsByJobId(this.trx, twoOldJob.jobID)).workItems;
      for (const item of twoOldJobItems) {
        item.status = WorkItemStatus.RUNNING;
        await item.save(db);
      }

      // advance by a day so that twoOldJob's WorkItems will
      // have been running for a whole day and should get picked up again by the WorkFailer
      MockDate.set('1/3/2000');

      const response = await workFailer.proccessWorkItemUpdates(failDurationMinutes);
      
      twoOldJobItems = (await getWorkItemsByJobId(db, twoOldJob.jobID)).workItems;
      expect(twoOldJobItems.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(2);
      expect(twoOldJobItems.filter((item) => item.retryCount === 2).length).to.equal(2);

      expect(response.jobIds.length).to.equal(1);
      expect(response.workItemIds.length).to.equal(2);
    });
  });
});
