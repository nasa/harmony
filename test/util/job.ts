import { v4 as uuid } from 'uuid';
import { expect } from 'chai';
import _ from 'lodash';
import { hookTransaction } from '../helpers/db';
import { JobRecord, JobStatus, Job } from '../../app/models/job';
import { stubTerminateWorkflows } from '../helpers/workflows';
import cancelAndSaveJob from '../../app/util/job';
import log from '../../app/util/log';

const aJob: JobRecord = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [
    {
      href: 'http://example.com',
      rel: 'link',
      type: 'text/plain',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    }],
  request: 'http://example.com/harmony?job=aJob',
};

const anotherJob: JobRecord = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [
    {
      href: 'http://example.com',
      rel: 'link',
      type: 'text/plain',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    }],
  request: 'http://example.com/harmony?job=aJob',
};

describe('Canceling a job', async function () {
  hookTransaction();
  let terminateWorkflowsStub: sinon.SinonStub;
  before(async function () {
    await new Job(aJob).save(this.trx);
    await new Job(anotherJob).save(this.trx);
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
