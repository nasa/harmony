/* eslint-disable no-loop-func */
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import {
  jobsEqual,
  resumeJob,
  adminResumeJob,
  hookResumeJob,
  hookAdminResumeJob,
  adminUsername,
  hookResumeJobWithGET,
  hookAdminResumeJobWithGET,
  buildJob,
} from '../helpers/jobs';
import { hookRedirect } from '../helpers/hooks';
import { JobRecord, JobStatus, Job } from '../../app/models/job';

const normalUsername = 'joe';

// unit tests for pausing/resuming jobs

describe('Pausing jobs', function () {
  describe('When a job is running', function () {
    const requestId = uuid();
    const runningJob = new Job({
      jobID: requestId,
      username: 'anonymouse',
      requestId,
      status: JobStatus.RUNNING,
      request: 'foo',
      numInputGranules: 10,
      collectionIds: ['C123'],
    });

    describe('and it is resumed before pausing', function () {
      it('throws an error', function () {
        expect(runningJob.resume.bind(runningJob)).to.throw('Job status is running - only paused jobs can be resumed.');
      });
    });

    describe('and it is paused', function () {
      it('status is PAUSED', function () {
        runningJob.pause();
        expect(runningJob.status).to.eql(JobStatus.PAUSED);
        expect(runningJob.isPaused()).to.be.true;
      });
      describe('when it is resumed', function () {
        it('status is RUNNING', function () {
          runningJob.resume();
          expect(runningJob.status).to.equal(JobStatus.RUNNING);
          expect(runningJob.isPaused()).to.be.false;
        });
      });
    });
  });

  describe('When a job is not running', function () {
    const requestid = uuid();
    const successfulJob = new Job({
      jobID: requestid,
      username: 'anonymouse',
      requestId: requestid,
      status: JobStatus.SUCCESSFUL,
      request: 'foo',
      numInputGranules: 10,
      collectionIds: ['C123'],
    });
    describe('and it is paused', function () {
      it('throws an error', function () {
        expect(successfulJob.pause.bind(successfulJob)).to.throw('Job status cannot be updated from successful to paused.');
      });
    });
  });
});

// integration tests for resuming jobs

/**
 * 
 * Define common tests to be run for resuming jobs to allow use with admin/normal endpoints
 * 
 * @param resumeEndpointHook - hook function to be used to resume job.
 * @param username - user to use when calling Harmony
 */
function resumeJobCommonTests(resumeEndpointHook: Function, username: string): void {
  describe('when the job does not exist', function () {
    const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
    resumeEndpointHook({ jobID: idDoesNotExist, username });
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
    resumeEndpointHook({ jobID: invalidJobID, username });
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

  describe('when resuming a running job', function () {
    const successfulJob = buildJob({ username: normalUsername });
    successfulJob.status = JobStatus.RUNNING;
    hookTransaction();
    before(async function () {
      await new Job(successfulJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    resumeEndpointHook({ jobID: successfulJob.requestId, username });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be resumed', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status is running - only paused jobs can be resumed.',
      });
    });
  });

  describe('when resuming a successful job', function () {
    const successfulJob = buildJob({ username: normalUsername });
    successfulJob.status = JobStatus.SUCCESSFUL;
    hookTransaction();
    before(async function () {
      await new Job(successfulJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    resumeEndpointHook({ jobID: successfulJob.requestId, username });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be resumed', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status is successful - only paused jobs can be resumed.',
      });
    });
  });

  describe('when resuming a failed job', function () {
    const failedJob = buildJob({ username: normalUsername });
    failedJob.status = JobStatus.FAILED;
    hookTransaction();
    before(async function () {
      await new Job(failedJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    resumeEndpointHook({ jobID: failedJob.requestId, username });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be resumed', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status is failed - only paused jobs can be resumed.',
      });
    });
  });

  describe('when resuming a canceled job', function () {
    const canceledJob = buildJob({ username: normalUsername });
    canceledJob.status = JobStatus.CANCELED;
    hookTransaction();
    before(async function () {
      await new Job(canceledJob).save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    resumeEndpointHook({ jobID: canceledJob.requestId, username });
    it('returns a 409 HTTP conflict', function () {
      expect(this.res.statusCode).to.equal(409);
    });

    it('returns a JSON error response indicating the job cannot be resumed', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.ConflictError',
        description: 'Error: Job status is canceled - only paused jobs can be resumed.',
      });
    });
  });
}


describe('Resuming a job - user endpoint', function () {
  const resumeEndpointHooks = {
    POST: hookResumeJob,
    GET: hookResumeJobWithGET,
  };
  for (const [httpMethod, resumeEndpointHook] of Object.entries(resumeEndpointHooks)) {
    describe(`Resuming using ${httpMethod}`, function () {
      hookServersStartStop({ skipEarthdataLogin: false });
      hookTransaction();
      const joeJob1 = buildJob({ username: normalUsername });
      before(async function () {
        joeJob1.pause();
        await joeJob1.save(this.trx);
        this.trx.commit();
        this.trx = null;
      });
      const { jobID } = joeJob1;
      describe('For a user who is not logged in', function () {
        before(async function () {
          this.res = await resumeJob(this.frontend, { jobID } as Job).redirects(0);
        });
        it('redirects to Earthdata Login', function () {
          expect(this.res.statusCode).to.equal(303);
          expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
        });

        it('sets the "redirect" cookie to the originally-requested resource', function () {
          expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/resume`));
        });
      });

      describe('For a logged-in user who owns the job', function () {
        resumeEndpointHook({ jobID, username: normalUsername });

        it('returns a redirect to the running job', function () {
          expect(this.res.statusCode).to.equal(302);
          expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
        });

        describe('When following the redirect to the resumed job', function () {
          hookRedirect(normalUsername);
          it('returns an HTTP success response', function () {
            expect(this.res.statusCode).to.equal(200);
          });

          it('changes the status to running', function () {
            const actualJob = JSON.parse(this.res.text);
            expect(actualJob.status).to.eql('running');
          });

          it('sets the message to the job is being processed', function () {
            const actualJob = JSON.parse(this.res.text);
            expect(actualJob.message).to.eql('The job is being processed');
          });

          it('does not modify any of the other job fields', function () {
            const actualJob = new Job(JSON.parse(this.res.text));
            const expectedJob: JobRecord = _.cloneDeep(joeJob1);
            expectedJob.message = 'The job is being processed';
            expectedJob.status = JobStatus.RUNNING;
            expect(jobsEqual(expectedJob, actualJob)).to.be.true;
          });
        });
      });

      describe('For a logged-in admin who does not own the job', function () {
        const joeJob2 = buildJob({ username: normalUsername });
        hookTransaction();
        before(async function () {
          await new Job(joeJob2).save(this.trx);
          this.trx.commit();
          this.trx = null;
        });
        resumeEndpointHook({ jobID: joeJob2.requestId, username: adminUsername });
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

      resumeJobCommonTests(resumeEndpointHook, normalUsername);
    });
  }
});

describe('Resuming a job - admin endpoint', function () {
  const resumeEndpointHooks = {
    POST: hookAdminResumeJob,
    GET: hookAdminResumeJobWithGET,
  };
  for (const [httpMethod, resumeEndpointHook] of Object.entries(resumeEndpointHooks)) {
    describe(`Resuming using ${httpMethod}`, function () {
      hookServersStartStop({ skipEarthdataLogin: false });
      hookTransaction();
      const joeJob1 = buildJob({ username: normalUsername });
      before(async function () {
        joeJob1.pause();
        await joeJob1.save(this.trx);
        this.trx.commit();
        this.trx = null;
      });
      const jobID = joeJob1.requestId;
      describe('For a user who is not logged in', function () {
        before(async function () {
          this.res = await adminResumeJob(this.frontend, { jobID } as Job).redirects(0);
        });
        it('redirects to Earthdata Login', function () {
          expect(this.res.statusCode).to.equal(303);
          expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
        });

        it('sets the "redirect" cookie to the originally-requested resource', function () {
          expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/resume`));
        });
      });

      describe('For a logged-in user (but not admin) who owns the job', function () {
        resumeEndpointHook({ jobID, username: normalUsername });
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
        resumeEndpointHook({ jobID, username: adminUsername });
        it('returns a redirect to the resumed job', function () {
          expect(this.res.statusCode).to.equal(302);
          expect(this.res.headers.location).to.include(`/admin/jobs/${jobID}`);
        });

        describe('When following the redirect to the resumed job', function () {
          hookRedirect(adminUsername);
          it('returns an HTTP success response', function () {
            expect(this.res.statusCode).to.equal(200);
          });

          it('changes the status to running', function () {
            const actualJob = JSON.parse(this.res.text);
            expect(actualJob.status).to.eql('running');
          });
          it('sets the message to the job is being processed', function () {
            const actualJob = JSON.parse(this.res.text);
            expect(actualJob.message).to.eql('The job is being processed');
          });
          it('does not modify any of the other job fields', function () {
            const actualJob = new Job(JSON.parse(this.res.text));
            const expectedJob: JobRecord = _.cloneDeep(joeJob1);
            expectedJob.message = 'The job is being processed';
            expectedJob.status = JobStatus.RUNNING;
            expect(jobsEqual(expectedJob, actualJob)).to.be.true;
          });
        });
      });

      resumeJobCommonTests(resumeEndpointHook, adminUsername);
    });
  }
});
