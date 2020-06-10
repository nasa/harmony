import { v4 as uuid } from 'uuid';
import { expect } from 'chai';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { jobsEqual, cancelJob, hookCancelJob, adminUsername } from '../helpers/jobs';
import { hookRedirect } from '../helpers/hooks';
import { JobRecord, JobStatus, Job } from '../../app/models/job';

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

describe('Canceling a job', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await new Job(aJob).save(this.trx);
    this.trx.commit();
    this.trx = null;
  });
  const jobID = aJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await cancelJob(this.frontend, { jobID }).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/cancel`));
    });
  });

  describe('For a logged-in user who owns the job', function () {
    hookCancelJob({ jobID, username: 'joe' });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
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
        const actualJob: Job = JSON.parse(this.res.text);
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
      await new Job(joeJob2).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJob({ jobID: joeJob2.requestId, username: adminUsername });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${joeJob2.requestId}`);
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
        const actualJob: Job = JSON.parse(this.res.text);
        const expectedJob: JobRecord = _.cloneDeep(joeJob2);
        expectedJob.message = 'foo';
        actualJob.message = 'foo';
        actualJob.status = JobStatus.CANCELED;
        expectedJob.status = JobStatus.CANCELED;
        expect(jobsEqual(expectedJob, actualJob)).to.be.true;
      });
    });
  });

  describe('For a logged-in admin who owns the job', function () {
    const adminJob = _.cloneDeep(aJob);
    adminJob.username = adminUsername;
    adminJob.requestId = uuid().toString();
    hookTransaction();
    before(async function () {
      await new Job(adminJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJob({ jobID: adminJob.requestId, username: adminUsername });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${adminJob.requestId}`);
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
      it('sets the message to canceled by user', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.message).to.eql('Canceled by user.');
      });
      it('does not modify any of the other job fields', function () {
        const actualJob: Job = JSON.parse(this.res.text);
        const expectedJob: JobRecord = _.cloneDeep(adminJob);
        expectedJob.message = 'foo';
        actualJob.message = 'foo';
        actualJob.status = JobStatus.CANCELED;
        expectedJob.status = JobStatus.CANCELED;
        expect(jobsEqual(expectedJob, actualJob)).to.be.true;
      });
    });
  });

  describe('For a logged-in non-admin user who does not own the job', function () {
    hookCancelJob({ jobID, username: 'jill' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${jobID}` });
    });
  });

  describe('when the job does not exist', function () {
    const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
    hookCancelJob({ jobID: idDoesNotExist, username: 'joe' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${idDoesNotExist}` });
    });
  });

  describe('when the jobID is in an invalid format', function () {
    const notAJobID = 'foo';
    hookCancelJob({ jobID: notAJobID, username: 'joe' });
    it('returns a 400 HTTP bad request', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: `Error: Invalid format for Job ID '${notAJobID}'. Job ID must be a UUID.` });
    });
  });

  describe('when canceling a successful job', function () {
    const successfulJob = _.cloneDeep(aJob);
    successfulJob.requestId = uuid().toString();
    successfulJob.status = JobStatus.SUCCESSFUL;
    hookTransaction();
    before(async function () {
      await new Job(successfulJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookCancelJob({ jobID: successfulJob.requestId, username: 'joe' });
    it('returns a 400 HTTP bad request', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Job status cannot be updated from successful to canceled.' });
    });
  });


  describe('when canceling a failed job', function () {
    const failedJob = _.cloneDeep(aJob);
    failedJob.requestId = uuid().toString();
    failedJob.status = JobStatus.FAILED;
    hookTransaction();
    before(async function () {
      await new Job(failedJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookCancelJob({ jobID: failedJob.requestId, username: 'joe' });
    it('returns a 400 HTTP bad request', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response indicating the job cannot be canceled', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Job status cannot be updated from failed to canceled.' });
    });
  });

  describe('when canceling an already canceled job', function () {
    const canceledJob = _.cloneDeep(aJob);
    canceledJob.requestId = uuid().toString();
    canceledJob.status = JobStatus.CANCELED;
    hookTransaction();
    before(async function () {
      await new Job(canceledJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    hookCancelJob({ jobID: canceledJob.requestId, username: 'joe' });
    it('returns a redirect to the canceled job rather than an error', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${canceledJob.requestId}`);
    });
    describe('When following the redirect to the canceled job', function () {
      hookRedirect('joe');
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });
    });
  });
});
