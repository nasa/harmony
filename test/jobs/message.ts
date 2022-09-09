import { describe, it } from 'mocha';
import { Job, JobStatus, statesToDefaultMessages } from '../../app/models/job';
import { hookTransaction } from '../helpers/db';
import { assert, expect } from 'chai';
import { baseResultsLimitedMessage } from '../../app/middleware/cmr-granule-locator';
import { TestTurboService } from '../helpers/turbo-service';
import env from '../../app/util/env';
import { stub } from 'sinon';
import { buildOperation } from '../helpers/data-operation';
import { v4 as uuid } from 'uuid';


/**
 * A service config to use when building the TestTurboServices.
 */
const config = {
  name: 'first-service',
  type: { name: 'turbo' },
  collections: [{ id: 'collection' }],
  capabilities: {
    output_formats: ['image/tiff', 'application/x-netcdf4'],
    subsetting: {
    },
  },
};


describe('skipPreview, pause, resume, and updateStatus job message handling', async function () {
  describe('for a RUNNING job', function () {
    describe('with a default running message', function () {
      let job: Job;
      hookTransaction();
      before(async function () {
        this.previewThresholdStub = stub(env, 'previewThreshold').get(() => 100); // ensure initial job state is RUNNING
        const requestString = 'http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?maxResults=10';
        job = (new TestTurboService(config, buildOperation(undefined))).createJob(requestString);
        assert(job.status === JobStatus.RUNNING);
        await job.save(this.trx);
      });
      after(async function () {
        this.previewThresholdStub.restore();
      });
      it('sets the appropriate message when paused', async function () {
        job.pause();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
      });
      it('sets the appropriate message when resumed', async function () {
        job.resume();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq('The job is being processed');
      });
    });
    describe('with a results limited running message', function () {
      let job: Job;
      let limitedMessage: string;
      hookTransaction();
      before(async function () {
        this.previewThresholdStub = stub(env, 'previewThreshold').get(() => 100); // ensure initial job state is RUNNING
        limitedMessage = `${baseResultsLimitedMessage(100, 10)}.`;
        const requestString = 'http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?maxResults=10';
        job = (new TestTurboService(config, buildOperation(limitedMessage))).createJob(requestString);
        assert(job.status === JobStatus.RUNNING);
        await job.save(this.trx);
      });
      after(async function () {
        this.previewThresholdStub.restore();
      });
      it('sets the appropriate message when paused', async function () {
        job.pause();
        await job.save(this.trx);
        const updatedJob = await Job.byJobID(this.trx, job.jobID);
        expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
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
      let job: Job;
      let skipJob: Job;
      hookTransaction();
      before(async function () {
        this.previewThresholdStub = stub(env, 'previewThreshold').get(() => 5); // ensure initial job state is PREVIEWING
        const requestString = 'http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?maxResults=10';
        job = (new TestTurboService(config, buildOperation(undefined))).createJob(requestString);
        await job.save(this.trx);
        assert(job.status === JobStatus.PREVIEWING);
        skipJob = (new TestTurboService(config, buildOperation(undefined))).createJob(requestString);
        await skipJob.save(this.trx);
        assert(skipJob.status === JobStatus.PREVIEWING);
      });
      after(async function () {
        this.previewThresholdStub.restore();
      });
      describe('which is paused, then resumed', function () {
        it('sets the appropriate message when paused', async function () {
          job.pause();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
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
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
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
      let job: Job;
      let skipJob: Job;
      let completeJob: Job;
      let limitedMessage: string;
      hookTransaction();
      before(async function () {
        this.previewThresholdStub = stub(env, 'previewThreshold').get(() => 5); // ensure initial job state is PREVIEWING
        const requestString = 'http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?maxResults=10';
        limitedMessage = `${baseResultsLimitedMessage(100, 10)}.`;        
        job = (new TestTurboService(config, buildOperation(limitedMessage))).createJob(requestString);
        await job.save(this.trx);
        assert(job.status === JobStatus.PREVIEWING);
        skipJob = (new TestTurboService(config, buildOperation(limitedMessage))).createJob(requestString);
        await skipJob.save(this.trx);
        assert(skipJob.status === JobStatus.PREVIEWING);
        completeJob = (new TestTurboService(config, buildOperation(limitedMessage))).createJob(requestString);
        await completeJob.save(this.trx);
        assert(completeJob.status === JobStatus.PREVIEWING);
      });
      after(async function () {
        this.previewThresholdStub.restore();
      });
      describe('which is paused, then resumed', function () {
        it('sets the appropriate message when paused', async function () {
          job.pause();
          await job.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, job.jobID);
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
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
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
        });
        it('sets the appropriate message when resumed', async function () {
          skipJob.resume();
          await skipJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, skipJob.jobID);
          expect(updatedJob.message).to.eq(limitedMessage);
        });
      });
      describe('which is paused, then completed', function () {
        it('sets the appropriate message when paused', async function () {
          completeJob.pause();
          await completeJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, completeJob.jobID);
          expect(updatedJob.message).to.eq('The job is paused and may be resumed using the provided link');
        });
        it('sets the appropriate message when completed', async function () {
          completeJob.updateStatus(JobStatus.SUCCESSFUL);
          await completeJob.save(this.trx);
          const updatedJob = await Job.byJobID(this.trx, completeJob.jobID);
          expect(updatedJob.message).to.eq(limitedMessage);
        });
      });
    });
  });
});
describe('job constructor message handling', function () {
  describe('when given a JSON message', function () {
    describe('which contains a message for the current status', function () {
      let job: Job;
      before(function () {
        const jobID = uuid().toString();
        job = new Job({
          message: JSON.stringify({ 'failed':'something bad happened..' }),
          status: JobStatus.FAILED,
          jobID, 
          requestId: jobID, 
          username: 'jay', 
          request: '', 
          numInputGranules: 1, 
          collectionIds: [] });
      });
      it('uses the message from the map as the current status', function () {
        expect(job.getMessage(JobStatus.FAILED)).to.eq('something bad happened..');
        expect(job.message).to.eq('something bad happened..');
      });
    });
    describe('which has no message for the current status', function () {
      let job: Job;
      before(function () {
        const jobID = uuid().toString();
        job = new Job({
          message: JSON.stringify({ 'failed':'something bad happened..' }),
          status: JobStatus.RUNNING,
          jobID, 
          requestId: jobID, 
          username: 'jay', 
          request: '', 
          numInputGranules: 1, 
          collectionIds: [] });
      });
      it('uses the default message for that status', function () {
        expect(job.getMessage(JobStatus.FAILED)).to.eq(statesToDefaultMessages.running);
        expect(job.message).to.eq(statesToDefaultMessages.running);
      });
    });
  });
  describe('when given a string message', function () {
    let job: Job;
    before(function () {
      const jobID = uuid().toString();
      job = new Job({
        message: 'something bad happened..',
        status: JobStatus.FAILED,
        jobID, 
        requestId: jobID, 
        username: 'jay', 
        request: '', 
        numInputGranules: 1, 
        collectionIds: [] });
    });
    it('uses that message as the current status', function () {
      expect(job.getMessage(JobStatus.FAILED)).to.eq('something bad happened..');
      expect(job.message).to.eq('something bad happened..');
    });
  });
  describe('when given a null message', function () {
    let job: Job;
    before(function () {
      const jobID = uuid().toString();
      job = new Job({
        message: null,
        status: JobStatus.RUNNING,
        jobID, 
        requestId: jobID, 
        username: 'jay', 
        request: '', 
        numInputGranules: 1, 
        collectionIds: [] });
    });
    it('uses the default message for the current status', function () {
      expect(job.getMessage(JobStatus.RUNNING)).to.eq(statesToDefaultMessages.running);
      expect(job.message).to.eq(statesToDefaultMessages.running);
    });
  });
  describe('when given an undefined message', function () {
    let job: Job;
    before(function () {
      const jobID = uuid().toString();
      job = new Job({
        message: undefined,
        status: JobStatus.RUNNING,
        jobID, 
        requestId: jobID, 
        username: 'jay', 
        request: '', 
        numInputGranules: 1, 
        collectionIds: [] });
    });
    it('uses the default message for the current status', function () {
      expect(job.message).to.eq(statesToDefaultMessages.running);
      expect(job.getMessage(JobStatus.RUNNING)).to.eq(statesToDefaultMessages.running);
    });
  });
});