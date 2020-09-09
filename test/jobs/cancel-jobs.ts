import { v4 as uuid } from 'uuid';
import { expect } from 'chai';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { jobsEqual, cancelJob, hookCancelJob, adminUsername, adminCancelJob, hookAdminCancelJob } from '../helpers/jobs';
import { hookRedirect } from '../helpers/hooks';
import { JobRecord, JobStatus, Job } from '../../app/models/job';
import stubTerminateWorkflows from '../helpers/workflows';

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

describe('Canceling a job - user endpoint', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  let terminateWorkflowsStub;
  before(async function () {
    terminateWorkflowsStub = stubTerminateWorkflows();
    await new Job(aJob).save(this.trx);
    this.trx.commit();
    this.trx = null;
  });
  after(function () {
    terminateWorkflowsStub.restore();
  });
  const jobID = aJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      this.res = await cancelJob(this.frontend, { jobID }).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/cancel`));
    });

    it('does not terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('For a logged-in user who owns the job', function () {
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookCancelJob({ jobID, username: 'joe' });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
    });
    it('terminates the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(1);
    });
    describe('When following the redirect to the canceled job', function () {
      hookRedirect('joe');
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a single job record in JSON format', function () {
        const actualJob = JSON.parse(this.res.text);
        const expectedJobKeys = [
          'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request', 'jobID',
        ];
        expect(Object.keys(actualJob)).to.eql(expectedJobKeys);
      });

      it('changes the status to canceled', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.status).to.eql('canceled');
      });
      it('sets the message to canceled by user', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.message).to.eql('Canceled by user.');
      });
      it('does not modify any of the other job fields', function () {
        const actualJob = new Job(JSON.parse(this.res.text));
        const expectedJob: JobRecord = _.cloneDeep(aJob);
        expectedJob.message = 'foo';
        actualJob.message = 'foo';
        actualJob.status = JobStatus.CANCELED;
        expectedJob.status = JobStatus.CANCELED;
        expect(jobsEqual(expectedJob, actualJob)).to.be.true;
      });
    });
  });

  describe('For a logged-in admin who does not own the job', function () {
    const joeJob2 = _.cloneDeep(aJob);
    joeJob2.requestId = uuid().toString();
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(joeJob2).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJob({ jobID: joeJob2.requestId, username: adminUsername });
    it('returns a 404 not found', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${joeJob2.requestId}`,
      });
    });

    it('does not terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when the job does not exist', function () {
    const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookCancelJob({ jobID: idDoesNotExist, username: 'joe' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${idDoesNotExist}`,
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when the jobID is in an invalid format', function () {
    const notAJobID = 'foo';
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookCancelJob({ jobID: notAJobID, username: 'joe' });
    it('returns a 400 HTTP bad request', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: `Error: Invalid format for Job ID '${notAJobID}'. Job ID must be a UUID.`,
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when canceling a successful job', function () {
    const successfulJob = _.cloneDeep(aJob);
    successfulJob.requestId = uuid().toString();
    successfulJob.status = JobStatus.SUCCESSFUL;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(successfulJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookCancelJob({ jobID: successfulJob.requestId, username: 'joe' });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from successful to canceled.',
      });

      it('does not try to terminate the workflow', function () {
        expect(terminateWorkflowsStub.callCount).to.equal(0);
      });
    });
  });

  describe('when canceling a failed job', function () {
    const failedJob = _.cloneDeep(aJob);
    failedJob.requestId = uuid().toString();
    failedJob.status = JobStatus.FAILED;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(failedJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJob({ jobID: failedJob.requestId, username: 'joe' });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from failed to canceled.',
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when canceling an already canceled job', function () {
    const canceledJob = _.cloneDeep(aJob);
    canceledJob.requestId = uuid().toString();
    canceledJob.status = JobStatus.CANCELED;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(canceledJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookCancelJob({ jobID: canceledJob.requestId, username: 'joe' });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from canceled to canceled.',
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });
});

describe('Canceling a job - admin endpoint', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  let terminateWorkflowsStub;
  before(async function () {
    terminateWorkflowsStub = stubTerminateWorkflows();
    await new Job(aJob).save(this.trx);
    this.trx.commit();
    this.trx = null;
  });
  after(function () {
    terminateWorkflowsStub.restore();
  });
  const jobID = aJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      this.res = await adminCancelJob(this.frontend, { jobID }).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/cancel`));
    });

    it('does not terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('For a logged-in user (but not admin) who owns the job', function () {
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookAdminCancelJob({ jobID, username: 'joe' });
    it('returns a 403 forbidden because they are not an admin', function () {
      expect(this.res.statusCode).to.equal(403);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ForbiddenError',
        description: 'Error: You are not permitted to access this resource',
      });

      it('does not terminate the workflow', function () {
        expect(terminateWorkflowsStub.callCount).to.equal(0);
      });
    });
  });

  describe('For a logged-in admin', function () {
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookAdminCancelJob({ jobID, username: adminUsername });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/admin/jobs/${jobID}`);
    });

    it('terminates the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(1);
    });
    describe('When following the redirect to the canceled job', function () {
      hookRedirect(adminUsername);
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a single job record in JSON format', function () {
        const actualJob = JSON.parse(this.res.text);
        const expectedJobKeys = [
          'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request', 'jobID',
        ];
        expect(Object.keys(actualJob)).to.eql(expectedJobKeys);
      });

      it('changes the status to canceled', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.status).to.eql('canceled');
      });
      it('sets the message to canceled by admin', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.message).to.eql('Canceled by admin.');
      });
      it('does not modify any of the other job fields', function () {
        const actualJob = new Job(JSON.parse(this.res.text));
        const expectedJob: JobRecord = _.cloneDeep(aJob);
        expectedJob.message = 'foo';
        actualJob.message = 'foo';
        actualJob.status = JobStatus.CANCELED;
        expectedJob.status = JobStatus.CANCELED;
        expect(jobsEqual(expectedJob, actualJob)).to.be.true;
      });
    });
  });

  describe('when the job does not exist', function () {
    const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookAdminCancelJob({ jobID: idDoesNotExist, username: adminUsername });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${idDoesNotExist}`,
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when the jobID is in an invalid format', function () {
    const notAJobID = 'foo';
    before(function () {
      terminateWorkflowsStub.resetHistory();
    });
    hookAdminCancelJob({ jobID: notAJobID, username: adminUsername });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: `Error: Invalid format for Job ID '${notAJobID}'. Job ID must be a UUID.`,
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when canceling a successful job', function () {
    const successfulJob = _.cloneDeep(aJob);
    successfulJob.requestId = uuid().toString();
    successfulJob.status = JobStatus.SUCCESSFUL;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(successfulJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookAdminCancelJob({ jobID: successfulJob.requestId, username: adminUsername });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from successful to canceled.',
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when canceling a failed job', function () {
    const failedJob = _.cloneDeep(aJob);
    failedJob.requestId = uuid().toString();
    failedJob.status = JobStatus.FAILED;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(failedJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookAdminCancelJob({ jobID: failedJob.requestId, username: adminUsername });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from failed to canceled.',
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });

  describe('when canceling an already canceled job', function () {
    const canceledJob = _.cloneDeep(aJob);
    canceledJob.requestId = uuid().toString();
    canceledJob.status = JobStatus.CANCELED;
    hookTransaction();
    before(async function () {
      terminateWorkflowsStub.resetHistory();
      await new Job(canceledJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookAdminCancelJob({ jobID: canceledJob.requestId, username: adminUsername });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status cannot be updated from canceled to canceled.',
      });
    });

    it('does not try to terminate the workflow', function () {
      expect(terminateWorkflowsStub.callCount).to.equal(0);
    });
  });
});
