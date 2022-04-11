import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { JobStatus, Job } from './../../app/models/job';

// unit tests for pausing/resuming jobs

describe('Pausing jobs', function () {
  describe('When a job is running', function () {
    const requestid = uuid();
    const runningJob = new Job({
      jobID: requestid,
      username: 'anonymouse',
      requestId: requestid,
      status: JobStatus.RUNNING,
      request: 'foo',
      numInputGranules: 10,
      collectionIds: ['C123'],
    });

    describe('and it is resumed before pausing', function () {
      it('throws an error', function () {
        expect(runningJob.resume.bind(runningJob)).to.throw('Job is status is running - only paused jobs can be resumed.');
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