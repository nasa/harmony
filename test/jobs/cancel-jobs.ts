/* eslint-disable no-loop-func */
import { expect } from 'chai';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import {
  jobsEqual,
  cancelJob,
  hookCancelJob,
  adminUsername,
  adminCancelJob,
  hookAdminCancelJob,
  expectedJobKeys,
  hookCancelJobWithGET,
  hookAdminCancelJobWithGET,
  buildJob,
} from '../helpers/jobs';
import { hookRedirect } from '../helpers/hooks';
import { JobStatus, Job, SerializedJob } from '../../app/models/job';

describe('Canceling a job - user endpoint', function () {
  const cancelEndpointHooks = {
    POST: hookCancelJob,
    GET: hookCancelJobWithGET,
  };
  for (const [httpMethod, cancelEndpointHook] of Object.entries(cancelEndpointHooks)) {
    describe(`Canceling using ${httpMethod}`, function () {
      hookServersStartStop({ skipEarthdataLogin: false });
      hookTransaction();
      const joeJob1 = buildJob({ username: 'joe' });
      before(async function () {
        await joeJob1.save(this.trx);
        this.trx.commit();
        this.trx = null;
      });
      const { jobID } = joeJob1;
      describe('For a user who is not logged in', function () {
        before(async function () {
          this.res = await cancelJob(this.frontend, { jobID } as Job).redirects(0);
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
        cancelEndpointHook({ jobID, username: 'joe' });

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
            const actualJob = new SerializedJob(JSON.parse(this.res.text));
            const expectedJob = _.cloneDeep(joeJob1);
            expectedJob.setMessage('foo', JobStatus.CANCELED);
            actualJob.message = 'foo';
            actualJob.status = JobStatus.CANCELED;
            expectedJob.status = JobStatus.CANCELED;
            expect(jobsEqual(expectedJob, actualJob)).to.be.true;
          });
        });
      });

      describe('For a logged-in admin who does not own the job', function () {
        const joeJob2 = buildJob({ username: 'joe' });
        hookTransaction();
        before(async function () {
          await new Job(joeJob2).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });
        cancelEndpointHook({ jobID: joeJob2.requestId, username: adminUsername });
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
      });

      describe('when the job does not exist', function () {
        const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
        cancelEndpointHook({ jobID: idDoesNotExist, username: 'joe' });
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
      });

      describe('when the jobID is in an invalid format', function () {
        const invalidJobID = 'foo';
        cancelEndpointHook({ jobID: invalidJobID, username: 'joe' });
        it('returns a 400 HTTP bad request', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.RequestValidationError',
            description: `Error: Invalid format for Job ID '${invalidJobID}'. Job ID must be a UUID.`,
          });
        });
      });

      describe('when canceling a successful job', function () {
        const successfulJob = buildJob({ username: 'joe' });
        successfulJob.status = JobStatus.SUCCESSFUL;
        hookTransaction();
        before(async function () {
          await new Job(successfulJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });

        cancelEndpointHook({ jobID: successfulJob.requestId, username: 'joe' });
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
      });

      describe('when canceling a failed job', function () {
        const failedJob = buildJob({ username: 'joe' });
        failedJob.status = JobStatus.FAILED;
        hookTransaction();
        before(async function () {
          await new Job(failedJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });
        cancelEndpointHook({ jobID: failedJob.requestId, username: 'joe' });
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
      });

      describe('when canceling an already canceled job', function () {
        const canceledJob = buildJob({ username: 'joe' });
        canceledJob.status = JobStatus.CANCELED;
        hookTransaction();
        before(async function () {
          await new Job(canceledJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });

        cancelEndpointHook({ jobID: canceledJob.requestId, username: 'joe' });
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
      });
    });
  }
});

describe('Canceling a job - admin endpoint', function () {
  const cancelEndpointHooks = {
    POST: hookAdminCancelJob,
    GET: hookAdminCancelJobWithGET,
  };
  for (const [httpMethod, cancelEndpointHook] of Object.entries(cancelEndpointHooks)) {
    describe(`Canceling using ${httpMethod}`, function () {
      hookServersStartStop({ skipEarthdataLogin: false });
      hookTransaction();
      const joeJob1 = buildJob({ username: 'joe' });
      before(async function () {
        await joeJob1.save(this.trx);
        this.trx.commit();
        this.trx = null;
      });
      const jobID = joeJob1.requestId;
      describe('For a user who is not logged in', function () {
        before(async function () {
          this.res = await adminCancelJob(this.frontend, { jobID } as Job).redirects(0);
        });
        it('redirects to Earthdata Login', function () {
          expect(this.res.statusCode).to.equal(303);
          expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
        });

        it('sets the "redirect" cookie to the originally-requested resource', function () {
          expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/cancel`));
        });
      });

      describe('For a logged-in user (but not admin) who owns the job', function () {
        cancelEndpointHook({ jobID, username: 'joe' });
        it('returns a 403 forbidden because they are not an admin', function () {
          expect(this.res.statusCode).to.equal(403);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.ForbiddenError',
            description: 'Error: You are not permitted to access this resource',
          });
        });
      });

      describe('For a logged-in admin', function () {
        cancelEndpointHook({ jobID, username: adminUsername });
        it('returns a redirect to the canceled job', function () {
          expect(this.res.statusCode).to.equal(302);
          expect(this.res.headers.location).to.include(`/admin/jobs/${jobID}`);
        });

        describe('When following the redirect to the canceled job', function () {
          hookRedirect(adminUsername);
          it('returns an HTTP success response', function () {
            expect(this.res.statusCode).to.equal(200);
          });

          it('returns a single job record in JSON format', function () {
            const actualJob = JSON.parse(this.res.text);
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
            const actualJob = new SerializedJob(JSON.parse(this.res.text));
            const expectedJob: Job = _.cloneDeep(joeJob1);
            expectedJob.setMessage('foo', JobStatus.CANCELED);
            actualJob.message = 'foo';
            actualJob.status = JobStatus.CANCELED;
            expectedJob.status = JobStatus.CANCELED;
            expect(jobsEqual(expectedJob, actualJob)).to.be.true;
          });
        });
      });

      describe('when the job does not exist', function () {
        const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
        cancelEndpointHook({ jobID: idDoesNotExist, username: adminUsername });
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
      });

      describe('when the jobID is in an invalid format', function () {
        const notjoeJob1ID = 'foo';
        cancelEndpointHook({ jobID: notjoeJob1ID, username: adminUsername });
        it('returns a 409 HTTP conflict', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.RequestValidationError',
            description: `Error: Invalid format for Job ID '${notjoeJob1ID}'. Job ID must be a UUID.`,
          });
        });
      });

      describe('when canceling a successful job', function () {
        const successfulJob = buildJob({ username: 'joe' });
        successfulJob.status = JobStatus.SUCCESSFUL;
        hookTransaction();
        before(async function () {
          await new Job(successfulJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });
        cancelEndpointHook({ jobID: successfulJob.requestId, username: adminUsername });
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
      });

      describe('when canceling a failed job', function () {
        const failedJob = buildJob({ username: 'joe' });
        failedJob.status = JobStatus.FAILED;
        hookTransaction();
        before(async function () {
          await new Job(failedJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });

        cancelEndpointHook({ jobID: failedJob.requestId, username: adminUsername });
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
      });

      describe('when canceling an already canceled job', function () {
        const canceledJob = buildJob({ username: 'joe' });
        canceledJob.status = JobStatus.CANCELED;
        hookTransaction();
        before(async function () {
          await new Job(canceledJob).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });

        cancelEndpointHook({ jobID: canceledJob.requestId, username: adminUsername });
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
      });
    });
  }
});
