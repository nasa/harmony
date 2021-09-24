import { expect } from 'chai';
import _ from 'lodash';
import { buildJob } from '../helpers/jobs';
import { buildWorkItem } from '../helpers/work-items';
import { hookTransaction } from '../helpers/db';
import { stubTerminateWorkflows } from '../helpers/workflows';
import cancelAndSaveJob from '../../app/util/job';
import log from '../../app/util/log';

const anArgoJob = buildJob({ username: 'joe' });
const anotherArgoJob = buildJob({ username: 'joe' });
const aTurboJob = buildJob({ username: 'doe' });
const anotherTurboJob = buildJob({ username: 'doe' });
const aTurboWorkItem = buildWorkItem({ jobID: aTurboJob.jobID });

describe('Canceling a job', async function () {
  hookTransaction();
  let terminateWorkflowsStub: sinon.SinonStub;
  before(async function () {
    await anArgoJob.save(this.trx);
    await anotherArgoJob.save(this.trx);
    await aTurboJob.save(this.trx);
    await anotherTurboJob.save(this.trx);
    await aTurboWorkItem.save(this.trx);
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
  });

  describe('when workflow termination is not requested', async function () {
    it('does not terminates the workflow', async function () {
      await cancelAndSaveJob(anotherArgoJob.requestId, 'Canceled by admin', log, false, 'joe');
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when cancelation is requested for a turbo workflow', async function () {
    it('does not terminates the workflow', async function () {
      await cancelAndSaveJob(aTurboJob.requestId, 'Canceled by admin', log, true, 'doe');
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });
});
