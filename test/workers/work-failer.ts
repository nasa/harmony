import { describe } from 'mocha';
import MockDate from 'mockdate';
import { buildJob } from '../helpers/jobs';
import { Job, JobStatus } from '../../app/models/job';
import { getWorkItemsByJobId } from '../../app/models/work-item';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';
import logger from '../../app/util/log';
import { expect } from 'chai';
import WorkFailer, { WorkFailerConfig } from '../../app/workers/work-failer';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import env from '../../app/util/env';


const config: WorkFailerConfig = { logger };
const workFailer = new WorkFailer(config);
const failDuration = 35 * 60; // a little under 3 days

describe('WorkFailer', function () {
  // used to mock work items (create date), for items that are taking too long to complete
  const oldDate = '1/1/2000';
  // used to mock work items (create date), for items that have not been running for long
  const newDate = '1/5/2000';
  // dates that the WorkFailer is going to proccessWorkItemUpdates
  const retry1Date = '1/2/2000';
  const retry2Date = '1/3/2000';
  const retry3Date = '1/4/2000';

  // we'll trigger the WorkFailer this many times
  let retryLimit: number;

  let twoOldJob: Job;
  let oneOldJob: Job;
  let noneOldJob: Job;
  let readyItemJob: Job;

  hookTransaction();

  before(async function () {
    // WorkItems can be retried when the WorkFailer sends a WorkItem update
    retryLimit = env.workItemRetryLimit;
    env.workItemRetryLimit = 3;

    // this job has two long-running work items
    twoOldJob = buildJob({ status: JobStatus.RUNNING });
    await twoOldJob.save(this.trx);
    MockDate.set(oldDate); // make the below two work items "old" (has been running for a while)
    const twoOldJobItem1 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING });
    await twoOldJobItem1.save(this.trx);
    const twoOldJobItem2 = buildWorkItem({ jobID: twoOldJob.jobID, status: WorkItemStatus.RUNNING });
    await twoOldJobItem2.save(this.trx);
    MockDate.reset();

    // this job has 1 (out of 2) long-running work items
    oneOldJob = buildJob({ status: JobStatus.RUNNING_WITH_ERRORS });
    await oneOldJob.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const oneOldJobItem1 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await oneOldJobItem1.save(this.trx);
    MockDate.set(oldDate); // make the below work item "old" (has been running for a while)
    const oneOldJobItem2 = buildWorkItem({ jobID: oneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await oneOldJobItem2.save(this.trx);
    MockDate.reset();

    // this job has 0 long-running work items
    noneOldJob = buildJob({ status: JobStatus.RUNNING });
    await noneOldJob.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const noneOldJobItem1 = buildWorkItem({ jobID: noneOldJob.jobID, status: WorkItemStatus.RUNNING });
    await noneOldJobItem1.save(this.trx);

    // this job has an old work item in the ready state and a new one in the running state
    readyItemJob = buildJob({ status: JobStatus.RUNNING });
    await readyItemJob.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const readyItemJobItem1 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.RUNNING });
    await readyItemJobItem1.save(this.trx);

    MockDate.set(oldDate);
    const readyItemJobItem2 = buildWorkItem({ jobID: readyItemJob.jobID, status: WorkItemStatus.READY });
    await readyItemJobItem2.save(this.trx);
    MockDate.set(newDate);
  });

  after(async function () {
    await truncateAll();
    MockDate.reset();
    env.workItemRetryLimit = retryLimit;
  });

  describe('.proccessWorkItemUpdates', async function () {
    let initialProcessingResults: { workItemIds: number[]; jobIds: string[]; };
    
    it('retries work items (for running jobs) that have been running for too long', async function () {
      MockDate.set(retry1Date);
      const initialProcessingResults = await workFailer.proccessWorkItemUpdates(failDuration);
      
      const twoOldJobItems = (await getWorkItemsByJobId(this.trx, twoOldJob.jobID)).workItems;
      expect(twoOldJobItems.length).to.equal(2);
      expect(twoOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(2);

      const oneOldJobItems = (await getWorkItemsByJobId(this.trx, oneOldJob.jobID)).workItems;
      expect(oneOldJobItems.length).to.equal(1);
      expect(oneOldJobItems.filter((item) => item.retryCount === 1).length).to.equal(1);
    });

    // it('does not proccess long running work items in the READY state', async function () {

    // });

    // it('does not proccess jobs without long running work items', async function () {

    // });

    // it('fails the work items that have run for too long after retries are exhausted', async function () {
    //   MockDate.set(retry2Date);
    //   await workFailer.proccessWorkItemUpdates(failDuration);
    //   MockDate.set(retry3Date);
    //   await workFailer.proccessWorkItemUpdates(failDuration);
    // });

    // it('fails the work items that take too long to finish', async function () {
    //   const shouldFailJob1Items = (await getWorkItemsByJobId(this.trx, shouldFailJob1.jobID)).workItems;
    //   expect(shouldFailJob1Items.length).to.equal(2);
    //   expect(shouldFailJob1Items.filter((item) => item.status === WorkItemStatus.FAILED).length).to.equal(2);
    // });

    // it('cancels the rest of the work items for a failed job', async function () {
    //   const shouldFailJob2Items = (await getWorkItemsByJobId(this.trx, shouldFailJob2.jobID)).workItems;
    //   expect(shouldFailJob2Items.length).to.equal(2);
    //   expect(shouldFailJob2Items.filter((item) => item.status === WorkItemStatus.FAILED).length).to.equal(1);
    //   expect(shouldFailJob2Items.filter((item) => item.status === WorkItemStatus.CANCELED).length).to.equal(1);
    // });

    // it('does not fail work items that have not taken too long', async function () {
    //   const unproblematicJobItems = (await getWorkItemsByJobId(this.trx, unproblematicJob1.jobID)).workItems;
    //   expect(unproblematicJobItems.length).to.equal(1);
    //   expect(unproblematicJobItems.filter((item) => item.status === WorkItemStatus.RUNNING).length).to.equal(1);
    // });

    // it('fails the jobs associated with the work items that take too long to finish', async function () {
    //   const failedJob1 = await Job.byJobID(this.trx, shouldFailJob1.jobID);
    //   expect(failedJob1.status).to.equal(JobStatus.FAILED);

    //   const failedJob2 = await Job.byJobID(this.trx, shouldFailJob2.jobID);
    //   expect(failedJob2.status).to.equal(JobStatus.FAILED);
    // });

    // it('does not fail jobs associated with the work items that are not taking too long', async function () {
    //   const runningJob = await Job.byJobID(this.trx, unproblematicJob1.jobID);
    //   expect(runningJob.status).to.equal(JobStatus.RUNNING);
    // });

    // it('does not fail jobs associated with the work items in a READY state for a long time', async function () {
    //   const runningJob = await Job.byJobID(this.trx, unproblematicJob2.jobID);
    //   expect(runningJob.status).to.equal(JobStatus.RUNNING);
    // });
  });
});
