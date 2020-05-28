import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Job, JobStatus } from '../../app/models/job';
import { hookStubReceive, hookStubDelete, hookRunDeadLetterMonitor } from '../helpers/message-queue';
import { hookJobCreation } from '../helpers/jobs';
import db from '../../app/util/db';
import { hookTransactionFailure } from '../helpers/db';

describe('DeadLetterQueueMonitor', function () {
  describe('when the monitored queue is empty', function () {
    hookJobCreation();
    hookStubReceive({});
    hookStubDelete();
    hookRunDeadLetterMonitor();

    it('does not alter any existing jobs', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.ACCEPTED);
    });

    it('does not delete any messages', async function () {
      expect(this.deleteStub.called).to.be.false;
    });
  });

  describe('when the monitored queue contains a valid message with corresponding job', function () {
    hookJobCreation();
    hookStubReceive(function () {
      return {
        Messages: [{
          Body: JSON.stringify({ requestId: this.job.requestId }),
          ReceiptHandle: 'abc123',
        }],
      };
    });
    hookStubDelete();
    hookRunDeadLetterMonitor();

    it('marks the corresponding job as failed', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.FAILED);
    });

    it('deletes the message from the queue', async function () {
      expect(this.deleteStub.called).to.be.true;
      expect(this.deleteStub.firstCall.args[0]).to.eql({ QueueUrl: 'example-queue', ReceiptHandle: 'abc123' });
    });
  });

  describe('when the monitored queue contains a message without a job id', function () {
    hookJobCreation();
    hookStubReceive({
      Messages: [{
        Body: JSON.stringify({}),
        ReceiptHandle: 'abc123',
      }],
    });
    hookStubDelete();
    hookRunDeadLetterMonitor();

    it('does not alter any existing jobs', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.ACCEPTED);
    });

    it('deletes the message from the queue', async function () {
      expect(this.deleteStub.called).to.be.true;
      expect(this.deleteStub.firstCall.args[0]).to.eql({ QueueUrl: 'example-queue', ReceiptHandle: 'abc123' });
    });
  });

  describe('when the monitored queue contains a message without a job id that has no record', function () {
    hookJobCreation();
    hookStubReceive({
      Messages: [{
        Body: JSON.stringify({ requestId: 'missing' }),
        ReceiptHandle: 'abc123',
      }],
    });
    hookStubDelete();
    hookRunDeadLetterMonitor();

    it('does not alter any existing jobs', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.ACCEPTED);
    });

    it('deletes the message from the queue', async function () {
      expect(this.deleteStub.called).to.be.true;
      expect(this.deleteStub.firstCall.args[0]).to.eql({ QueueUrl: 'example-queue', ReceiptHandle: 'abc123' });
    });
  });

  describe('when the monitored queue contains a message with an invalid JSON format', function () {
    hookJobCreation();
    hookStubReceive({
      Messages: [{
        Body: '{',
        ReceiptHandle: 'abc123',
      }],
    });
    hookStubDelete();
    hookRunDeadLetterMonitor();

    it('does not alter any existing jobs', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.ACCEPTED);
    });

    it('deletes the message from the queue', async function () {
      expect(this.deleteStub.called).to.be.true;
      expect(this.deleteStub.firstCall.args[0]).to.eql({ QueueUrl: 'example-queue', ReceiptHandle: 'abc123' });
    });
  });

  describe('when processing the message fails due to database errors', function () {
    hookJobCreation();
    hookStubReceive(function () {
      return {
        Messages: [{
          Body: JSON.stringify({ requestId: this.job.requestId }),
          ReceiptHandle: 'abc123',
        }],
      };
    });
    hookStubDelete();
    hookTransactionFailure();
    hookRunDeadLetterMonitor();

    it('does not alter any existing jobs', async function () {
      expect(this.receiveStub.called).to.be.true;
      const job = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.ACCEPTED);
    });

    it('does not delete any messages', async function () {
      expect(this.deleteStub.called).to.be.false;
    });
  });
});
