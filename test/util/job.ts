import { expect } from 'chai';
import _ from 'lodash';
import { buildJob } from '../helpers/jobs';
import { buildWorkItem } from '../helpers/work-items';
import { hookTransaction } from '../helpers/db';
import { stubTerminateWorkflows } from '../helpers/workflows';
import cancelAndSaveJob from '../../app/util/job';
import { JobStatus } from '../../app/models/job';
import { getWorkItemsByJobId, WorkItemStatus } from '../../app/models/work-item';
import db from '../../app/util/db';
import log from '../../app/util/log';

const anArgoJob = buildJob({ username: 'joe' });
const anotherArgoJob = buildJob({ username: 'joe' });
const aTurboJob = buildJob({ username: 'doe' });
const anotherTurboJob = buildJob({ username: 'doe' });
const readyTurboJob = buildJob({ username: 'doe', status: JobStatus.READY });
const finishedTurboJob = buildJob({ username: 'doe', status: JobStatus.SUCCESSFUL });
const failedTurboJob = buildJob({ username: 'doe', status: JobStatus.FAILED });
const aTurboWorkItem = buildWorkItem({ jobID: aTurboJob.jobID });
const anotherTurboWorkItem = buildWorkItem({ jobID: anotherTurboJob.jobID });
const readyTurboWorkItem = buildWorkItem({
  jobID: readyTurboJob.jobID,
  status: WorkItemStatus.READY,
});
const finishedTurboWorkItem = buildWorkItem({
  jobID: finishedTurboJob.jobID,
  status: WorkItemStatus.SUCCESSFUL,
});
const failedTurboWorkItem = buildWorkItem({
  jobID: failedTurboJob.jobID,
  status: WorkItemStatus.FAILED,
});

describe('Canceling a job', async function () {
  hookTransaction();
  let terminateWorkflowsStub: sinon.SinonStub;
  before(async function () {
    await anArgoJob.save(this.trx);
    await anotherArgoJob.save(this.trx);
    await aTurboJob.save(this.trx);
    await anotherTurboJob.save(this.trx);
    await readyTurboJob.save(this.trx);
    await finishedTurboJob.save(this.trx);
    await failedTurboJob.save(this.trx);
    await aTurboWorkItem.save(this.trx);
    await anotherTurboWorkItem.save(this.trx);
    await readyTurboWorkItem.save(this.trx);
    await finishedTurboWorkItem.save(this.trx);
    await failedTurboWorkItem.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  beforeEach(function () {
    terminateWorkflowsStub = stubTerminateWorkflows();
  });
  afterEach(function () {
    if (terminateWorkflowsStub.restore) terminateWorkflowsStub.restore();
  });

  describe('when workflow termination is requested', async function () {
    it('terminates the workflow', async function () {
      await cancelAndSaveJob(anArgoJob.requestId, 'Canceled by admin', log, true, 'joe');
      expect(terminateWorkflowsStub.callCount).to.equal(1);
    });

    it('does not terminates the workflow', async function () {
      await cancelAndSaveJob(anotherArgoJob.requestId, 'Canceled by admin', log, false, 'joe');
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when cancelation is requested for a turbo workflow', async function () {
    it('is able to cancel the job in ready state', async function () {
      await cancelAndSaveJob(readyTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      const { workItems } = await getWorkItemsByJobId(db, readyTurboWorkItem.jobID);
      expect(workItems[0].status).to.equal('canceled');
    });

    it('is able to cancel the job in running state', async function () {
      await cancelAndSaveJob(aTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      const { workItems } = await getWorkItemsByJobId(db, aTurboWorkItem.jobID);
      expect(workItems[0].status).to.equal('canceled');
    });

    it('does not terminates the workflow', async function () {
      await cancelAndSaveJob(anotherTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });

    it('fails to cancel an already-canceled workflow', async function () {
      await expect(
        cancelAndSaveJob(anotherTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from canceled to canceled.');
    });

    it('fails to cancel an already-finished workflow', async function () {
      await expect(
        cancelAndSaveJob(finishedTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from successful to canceled.');
    });

    it('fails to cancel a failed workflow', async function () {
      await expect(
        cancelAndSaveJob(failedTurboJob.requestId, 'Canceled by admin', log, true, 'doe'),
      ).to.be.rejectedWith('Job status cannot be updated from failed to canceled.');
    });
  });
});
