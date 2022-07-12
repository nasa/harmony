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

describe('WorkFailer', function () {
  // used to mock work items (create date), for items that have not been running for long
  const newDate = '1/1/2000';
  // used to mock work items (create date), for items that are taking too long to complete
  const oldDate = '1/1/1900';

  let shouldFailJob1: Job;
  let shouldFailJob2: Job;
  let unproblematicJob1: Job;
  let unproblematicJob2: Job;

  hookTransaction();

  before(async function () {
    // this job has two long-running work items
    shouldFailJob1 = buildJob({ status: JobStatus.RUNNING });
    await shouldFailJob1.save(this.trx);
    MockDate.set(oldDate); // make the below two work items "old" (has been running for a while)
    const shouldFailJob1Item1 = buildWorkItem({ jobID: shouldFailJob1.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob1Item1.save(this.trx);
    const shouldFailJob1Item2 = buildWorkItem({ jobID: shouldFailJob1.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob1Item2.save(this.trx);
    MockDate.reset();

    // this job has 1 (out of 2) long-running work items
    shouldFailJob2 = buildJob({ status: JobStatus.RUNNING });
    await shouldFailJob2.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const shouldFailJob2Item1 = buildWorkItem({ jobID: shouldFailJob2.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob2Item1.save(this.trx);
    MockDate.set(oldDate); // make the below work item "old" (has been running for a while)
    const shouldFailJob2Item2 = buildWorkItem({ jobID: shouldFailJob2.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob2Item2.save(this.trx);
    MockDate.reset();

    // this job has 0 long-running work items
    unproblematicJob1 = buildJob({ status: JobStatus.RUNNING });
    await unproblematicJob1.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const unproblematicJob1Item1 = buildWorkItem({ jobID: unproblematicJob1.jobID, status: WorkItemStatus.RUNNING });
    await unproblematicJob1Item1.save(this.trx);

    // this job has an old work item in the ready state and a new one in the running state
    unproblematicJob2 = buildJob({ status: JobStatus.RUNNING });
    await unproblematicJob2.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const unproblematicJob2Item1 = buildWorkItem({ jobID: unproblematicJob2.jobID, status: WorkItemStatus.RUNNING });
    await unproblematicJob2Item1.save(this.trx);

    MockDate.set(oldDate);
    const unproblematicJob2Item2 = buildWorkItem({ jobID: unproblematicJob2.jobID, status: WorkItemStatus.READY });
    await unproblematicJob2Item2.save(this.trx);
    MockDate.set(newDate);

    const config: WorkFailerConfig = { logger };
    const workFailer = new WorkFailer(config);
    await workFailer.failWork(60, this.trx);
    MockDate.reset();
  });

  after(async function () {
    await truncateAll();
    MockDate.reset();
  });

  describe('.failWork', async function () {

    it('fails the work items that take too long to finish', async function () {
      const shouldFailJob1Items = (await getWorkItemsByJobId(this.trx, shouldFailJob1.jobID)).workItems;
      expect(shouldFailJob1Items.length).to.equal(2);
      expect(shouldFailJob1Items.filter((item) => item.status === WorkItemStatus.FAILED).length).to.equal(2);
    });

    it('cancels the rest of the work items for a failed job', async function () {
      const shouldFailJob2Items = (await getWorkItemsByJobId(this.trx, shouldFailJob2.jobID)).workItems;
      expect(shouldFailJob2Items.length).to.equal(2);
      expect(shouldFailJob2Items.filter((item) => item.status === WorkItemStatus.FAILED).length).to.equal(1);
      expect(shouldFailJob2Items.filter((item) => item.status === WorkItemStatus.CANCELED).length).to.equal(1);
    });

    it('does not fail work items that have not taken too long', async function () {
      const unproblematicJobItems = (await getWorkItemsByJobId(this.trx, unproblematicJob1.jobID)).workItems;
      expect(unproblematicJobItems.length).to.equal(1);
      expect(unproblematicJobItems.filter((item) => item.status === WorkItemStatus.RUNNING).length).to.equal(1);
    });

    it('fails the jobs associated with the work items that take too long to finish', async function () {
      const failedJob1 = await Job.byJobID(this.trx, shouldFailJob1.jobID);
      expect(failedJob1.status).to.equal(JobStatus.FAILED);

      const failedJob2 = await Job.byJobID(this.trx, shouldFailJob2.jobID);
      expect(failedJob2.status).to.equal(JobStatus.FAILED);
    });

    it('does not fail jobs associated with the work items that are not taking too long', async function () {
      const runningJob = await Job.byJobID(this.trx, unproblematicJob1.jobID);
      expect(runningJob.status).to.equal(JobStatus.RUNNING);
    });

    it('does not fail jobs associated with the work items in a READY state for a long time', async function () {
      const runningJob = await Job.byJobID(this.trx, unproblematicJob2.jobID);
      expect(runningJob.status).to.equal(JobStatus.RUNNING);
    });
  });
});
