import { expect } from 'chai';
import _ from 'lodash';
import { buildJob } from '../helpers/jobs';
import { buildWorkItem } from '../helpers/work-items';
import { hookTransaction } from '../helpers/db';
import cancelAndSaveJob from '../../app/util/job';
import { JobStatus } from '../../app/models/job';
import { getWorkItemsByJobId, WorkItemStatus } from '../../app/models/work-item';
import db from '../../app/util/db';
import log from '../../app/util/log';

const aTurboJob = buildJob({ username: 'doe' });
const firstTurboWorkItem = buildWorkItem({ jobID: aTurboJob.jobID });
const secondTurboWorkItem = buildWorkItem({
  jobID: aTurboJob.jobID,
  status: WorkItemStatus.SUCCESSFUL,
});
const thirdTurboWorkItem = buildWorkItem({
  jobID: aTurboJob.jobID,
  status: WorkItemStatus.FAILED,
});

const anotherTurboJob = buildJob({ username: 'doe' });
const anotherTurboWorkItem = buildWorkItem({ jobID: anotherTurboJob.jobID });

const acceptedTurboJob = buildJob({ username: 'doe', status: JobStatus.ACCEPTED });
const readyTurboWorkItem = buildWorkItem({
  jobID: acceptedTurboJob.jobID,
  status: WorkItemStatus.READY,
});

const finishedTurboJob = buildJob({ username: 'doe', status: JobStatus.SUCCESSFUL });
const finishedTurboWorkItem = buildWorkItem({
  jobID: finishedTurboJob.jobID,
  status: WorkItemStatus.SUCCESSFUL,
});

const failedTurboJob = buildJob({ username: 'doe', status: JobStatus.FAILED });
const failedTurboWorkItem = buildWorkItem({
  jobID: failedTurboJob.jobID,
  status: WorkItemStatus.FAILED,
});

describe('Canceling a job', async function () {
  hookTransaction();
  before(async function () {
    await aTurboJob.save(this.trx);
    await anotherTurboJob.save(this.trx);
    await acceptedTurboJob.save(this.trx);
    await finishedTurboJob.save(this.trx);
    await failedTurboJob.save(this.trx);
    await firstTurboWorkItem.save(this.trx);
    await secondTurboWorkItem.save(this.trx);
    await thirdTurboWorkItem.save(this.trx);
    await anotherTurboWorkItem.save(this.trx);
    await readyTurboWorkItem.save(this.trx);
    await finishedTurboWorkItem.save(this.trx);
    await failedTurboWorkItem.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  describe('when cancelation is requested for a turbo workflow', async function () {
    it('is able to cancel the job in accepted state', async function () {
      await cancelAndSaveJob(acceptedTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      const { workItems } = await getWorkItemsByJobId(db, readyTurboWorkItem.jobID);
      expect(workItems[0].status).to.equal(WorkItemStatus.CANCELED);
    });

    it('is able to cancel the job in running state', async function () {
      await cancelAndSaveJob(aTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      const { workItems } = await getWorkItemsByJobId(db, aTurboJob.jobID);
      expect(workItems[0].status).to.equal(WorkItemStatus.CANCELED);
      expect(workItems[1].status).to.equal(WorkItemStatus.SUCCESSFUL);
      expect(workItems[2].status).to.equal(WorkItemStatus.FAILED);
    });

    it('fails to cancel an already-canceled workflow', async function () {
      await cancelAndSaveJob(anotherTurboJob.requestId, 'Canceled by user', log, true, 'doe');
      await expect(
        cancelAndSaveJob(anotherTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from canceled to canceled.');
    });

    it('fails to cancel an already-finished workflow', async function () {
      await expect(
        cancelAndSaveJob(finishedTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from successful to canceled.');
      const { workItems } = await getWorkItemsByJobId(db, finishedTurboWorkItem.jobID);
      expect(workItems[0].status).to.equal(WorkItemStatus.SUCCESSFUL);
    });

    it('fails to cancel a failed workflow', async function () {
      await expect(
        cancelAndSaveJob(failedTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from failed to canceled.');
      const { workItems } = await getWorkItemsByJobId(db, failedTurboWorkItem.jobID);
      expect(workItems[0].status).to.equal(WorkItemStatus.FAILED);
    });
  });
});
