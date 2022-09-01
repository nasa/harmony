import { describe, it } from 'mocha';
import { buildJob } from '../helpers/jobs';
import { Job, JobStatus } from '../../app/models/job';
import { hookTransaction } from '../helpers/db';
import { expect } from 'chai';
import { baseResultsLimitedMessage } from '../../app/middleware/cmr-granule-locator';


describe('skipPreview, pause and resume job message handling', async function () {
  describe('for a RUNNING job', function () {
    describe('with a default running message', function () {
      let job;
      hookTransaction();
      before(async function () {
        job = buildJob({ status: JobStatus.RUNNING, message: 'The job is being processed.' });
        await job.save(this.trx);
      });
      it('sets the appropriate message when paused', async function () {
        job.pause();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link.');
      });
      it('sets the appropriate message when resumed', async function () {
        job.resume();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq('The job is being processed');
      });
    });
    describe('with a results limited running message', function () {
      let job;
      let limitedMessage;
      hookTransaction();
      before(async function () {
        limitedMessage = baseResultsLimitedMessage(100, 10);
        job = buildJob({ status: JobStatus.RUNNING, message: limitedMessage });
        await job.save(this.trx);
      });
      it('sets the appropriate message when paused', async function () {
        job.pause();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq(`The job is paused and may be resumed using the provided link. ${limitedMessage}`);
      });
      it('sets the appropriate message when resumed', async function () {
        job.resume();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq(limitedMessage);
      });
    });
  });
  describe('for a PREVIEWING job', function () {
    describe('with a default previewing message', function () {
      let job;
      let skipJob;
      hookTransaction();
      before(async function () {
        job = buildJob({ status: JobStatus.PREVIEWING, message: 'The job is generating a preview before auto-pausing.' });
        await job.save(this.trx);
        skipJob = buildJob({ status: JobStatus.PREVIEWING, message: 'The job is generating a preview before auto-pausing.' });
        await skipJob.save(this.trx);
      });
      describe('which is paused, then resumed', function () {
        it('sets the appropriate message when paused', async function () {
          job.pause();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link.');
        });
        it('sets the appropriate message when resumed', async function () {
          job.resume();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq('The job is being processed');
        });
      });
      describe('which skips preview, pauses, and then resumes', function () {
        it('sets the appropriate message when skipping preview', async function () {
          skipJob.skipPreview();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq('The job is being processed');
        });
        it('sets the appropriate message when paused', async function () {
          skipJob.pause();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link.');
        });
        it('sets the appropriate message when resumed', async function () {
          skipJob.resume();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq('The job is being processed');
        });
      });
    });
    describe('with a results limited previewing message', function () {
      let job;
      let skipJob;
      let limitedMessage;
      hookTransaction();
      before(async function () {
        limitedMessage = baseResultsLimitedMessage(100, 10);
        job = buildJob({ status: JobStatus.PREVIEWING, message: `The job is generating a preview before auto-pausing. ${limitedMessage}` });
        await job.save(this.trx);
        skipJob = buildJob({ status: JobStatus.PREVIEWING, message: `The job is generating a preview before auto-pausing. ${limitedMessage}` });
        await skipJob.save(this.trx);
      });
      describe('which is paused, then resumed', function () {
        it('sets the appropriate message when paused', async function () {
          job.pause();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq(`The job is paused and may be resumed using the provided link. ${limitedMessage}`);
        });
        it('sets the appropriate message when resumed', async function () {
          job.resume();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq(limitedMessage);
        });
      });
      describe('which skips preview, pauses, and then resumes', function () {
        it('sets the appropriate message when skipping preview', async function () {
          skipJob.skipPreview();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq(limitedMessage);
        });
        it('sets the appropriate message when paused', async function () {
          skipJob.pause();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq(`The job is paused and may be resumed using the provided link. ${limitedMessage}`);
        });
        it('sets the appropriate message when resumed', async function () {
          skipJob.resume();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq(limitedMessage);
        });
      });
    });
  });
});