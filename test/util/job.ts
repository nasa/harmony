import { expect } from 'chai';
import _ from 'lodash';
import { buildJob } from '../helpers/jobs';
import { hookTransaction } from '../helpers/db';
import { stubTerminateWorkflows } from '../helpers/workflows';
import cancelAndSaveJob from '../../app/util/job';
import log from '../../app/util/log';

const aJob = buildJob({ username: 'joe' });
const anotherJob = buildJob({ username: 'joe' });

describe('Canceling a job', async function () {
  hookTransaction();
  let terminateWorkflowsStub: sinon.SinonStub;
  before(async function () {
    await aJob.save(this.trx);
    await anotherJob.save(this.trx);
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
      await cancelAndSaveJob(aJob.requestId, 'Canceled by admin', log, true, 'joe');
      expect(terminateWorkflowsStub.callCount).to.equal(1);
    });
  });

  describe('when workflow termination is not requested', async function () {
    it('does not terminates the workflow', async function () {
      await cancelAndSaveJob(anotherJob.requestId, 'Canceled by admin', log, true, 'joe');
      expect(terminateWorkflowsStub.callCount).to.equal(1);
    });
  });
});
