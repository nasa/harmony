import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { Job, JobRecord, JobStatus, JobLink } from 'models/job';
import MockDate from 'mockdate';
import { buildJob } from 'test/helpers/jobs';
import { hookTransactionEach } from '../helpers/db';

const exampleProps: JobRecord = {
  requestId: uuid().toString(),
  jobID: uuid().toString(),
  username: 'joe',
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [{ href: 'http://example.com', rel: 'data' }],
  request: 'http://example.com/harmony?foo=bar',
  numInputGranules: 100,
};

describe('Job', function () {
  describe('retrieval methods', function () {
    hookTransactionEach();
    beforeEach(async function () {
      // Add records to the job table that should not be returned
      await buildJob({ username: 'dummy' }).save(this.trx);
      await buildJob({ username: 'dummy' }).save(this.trx);
    });

    describe('.forUser', function () {
      describe('when a user has jobs', function () {
        let jobs;
        beforeEach(async function () {
          jobs = [buildJob({ username: 'jdoe' }), buildJob({ username: 'jdoe' })];
          await Promise.all([jobs[0].save(this.trx), jobs[1].save(this.trx)]);
        });

        it("returns the user's jobs", async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          const requestIds = results.data.map((r) => r.requestId);
          expect(requestIds).to.include(jobs[0].requestId);
          expect(requestIds).to.include(jobs[1].requestId);
        });

        it("does not return other users' jobs", async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          const usernames = results.data.map((r) => r.username);
          expect(usernames).to.eql(['jdoe', 'jdoe']);
        });
      });

      describe('when a user has no jobs', async function () {
        it('returns an empty array', async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          expect(results.data).to.eql([]);
        });
      });
    });

    describe('.byUsernameAndRequestId', function () {
      let job;
      beforeEach(async function () {
        job = buildJob({ username: 'jdoe' });
        await job.save(this.trx);
      });

      describe('when a job matches the username and request id', function () {
        it('returns the matching job', async function () {
          const result = await Job.byUsernameAndRequestId(this.trx, 'jdoe', job.requestId);
          expect(result.id).to.eql(job.id);
        });
      });

      describe('when the username has a job but the request id does not', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndRequestId(this.trx, 'jdoe', uuid());
          expect(result).to.eql(null);
        });
      });

      describe('when the request id has a job but the username does not', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndRequestId(this.trx, 'notjdoe', job.requestId);
          expect(result).to.eql(null);
        });
      });

      describe('when neither the request id nor the username has a job', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndRequestId(this.trx, 'notjdoe', uuid());
          expect(result).to.eql(null);
        });
      });
    });

    describe('.byRequestId', function () {
      let job;
      beforeEach(async function () {
        job = buildJob({ username: 'jdoe' });
        await job.save(this.trx);
      });

      describe('when a job matches the request id', function () {
        it('returns the matching job', async function () {
          const result = await Job.byRequestId(this.trx, job.requestId);
          expect(result.id).to.eql(job.id);
        });
      });

      describe('when no job matches the request id', function () {
        it('returns null', async function () {
          const result = await Job.byRequestId(this.trx, uuid());
          expect(result).to.eql(null);
        });
      });
    });

    describe('.byId', function () {
      let job;
      beforeEach(async function () {
        job = buildJob({ username: 'jdoe' });
        await job.save(this.trx);
      });

      describe('when a job matches the id', function () {
        it('returns the matching job', async function () {
          const result = await Job.byId(this.trx, job.id);
          expect(result.id).to.eql(job.id);
        });
      });

      describe('when no job matches the id', function () {
        it('returns null', async function () {
          const result = await Job.byId(this.trx, 12345);
          expect(result).to.eql(null);
        });
      });
    });

    describe('.notUpdatedForMinutes', function () {
      let oldFinishedJob: Job;
      let oldRunningJob: Job;
      let newRunningJob: Job;
      let result;

      beforeEach(async function () {
        MockDate.set('1/30/2000');
        oldFinishedJob = buildJob({ username: 'bob' });
        oldFinishedJob.updateStatus(JobStatus.SUCCESSFUL);
        await oldFinishedJob.save(this.trx);
        oldRunningJob = buildJob({ username: 'jdoe' });
        oldRunningJob.updateStatus(JobStatus.RUNNING);
        await oldRunningJob.save(this.trx);
        MockDate.reset();
        newRunningJob = buildJob({ username: 'mary' });
        newRunningJob.updateStatus(JobStatus.RUNNING);
        await newRunningJob.save(this.trx);
        result = await Job.notUpdatedForMinutes(this.trx, 60);
      });

      afterEach(function () {
        MockDate.reset();
      });

      describe('when some jobs have been running longer than the given duration', function () {
        it('returns the matching jobs', async function () {
          expect(result.data[0].id).to.eql(oldRunningJob.id);
        });

        it('does not return other jobs', async function () {
          expect(result.data.length).to.equal(1);
        });
      });

      describe('when no job has been running longer than the given duration', function () {
        it('returns an empty array', async function () {
          MockDate.set('1/31/2000');
          result = await Job.notUpdatedForMinutes(this.trx, 2880); // 48 hours
          expect(result.data).to.eql([]);
        });
      });
    });
  });

  describe('#constructor', function () {
    it('copies passed fields to the job object', function () {
      const props = { id: 1234, ...exampleProps };
      const job = new Job(props);
      for (const key of Object.keys(props)) {
        expect(job[key]).to.eql(props[key]);
      }
    });

    it('defaults status to "accepted"', function () {
      expect(new Job({} as JobRecord).status).to.eql('accepted');
    });

    it('defaults progress to 0', function () {
      expect(new Job({} as JobRecord).progress).to.eql(0);
    });

    it('defaults message to a human readable version of the status', function () {
      expect(new Job({ status: JobStatus.FAILED } as JobRecord).message).to.eql('The job failed with an unknown error');
    });

    it('updates the message if a default was used and the status changed', function () {
      expect(new Job({ status: JobStatus.SUCCESSFUL, message: 'The job is being processed' } as JobRecord).message)
        .to.equal('The job has completed successfully');
    });

    it('defaults links to an empty array', function () {
      expect(new Job({} as JobRecord).links).to.eql([]);
    });

    it('parses _json_links into the .links property', function () {
      expect(new Job({ _json_links: '[{"href":"https://example.com"}]' } as JobRecord).links)
        .to.eql([{ href: 'https://example.com' }]);
    });
  });

  describe('#save', function () {
    hookTransactionEach();

    it('inserts new records', async function () {
      const job = new Job(exampleProps);
      await job.save(this.trx);
      const result = await Job.byRequestId(this.trx, job.requestId);
      for (const key of Object.keys(exampleProps)) {
        expect(job[key]).to.eql(exampleProps[key]);
      }
      expect(result.id).to.eql(job.id);
    });

    it('updates existing records', async function () {
      const job = new Job(exampleProps);
      await job.save(this.trx);
      job.username = 'notjdoe';
      await job.save(this.trx);
      const result = await Job.byRequestId(this.trx, job.requestId);
      expect(result.username).to.eql('notjdoe');
    });

    it('sets the id field of new records', async function () {
      const job = new Job(exampleProps);
      await job.save(this.trx);
      expect(job.id).to.be;
    });

    it('saves changes to the links array', async function () {
      let job = new Job(exampleProps);
      await job.save(this.trx);
      job = await Job.byRequestId(this.trx, job.requestId);
      job.links.push({ href: 'http://example.com/2' } as JobLink);
      await job.save(this.trx);
      const result = await Job.byRequestId(this.trx, job.requestId);
      expect(result.links).to.eql(job.links);
    });

    it('throws an error when progress is outside of the allowable range', async function () {
      const { trx } = this;
      const job = new Job({ username: 'jdoe', requestId: uuid().toString(), progress: 101 } as JobRecord);
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('throws an error when requestId is not provided', async function () {
      const { trx } = this;
      const job = new Job({ username: 'jdoe' } as JobRecord);
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('throws an error when username is not provided', async function () {
      const { trx } = this;
      const job = new Job({ requestId: uuid().toString() } as JobRecord);
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('throws an error when the request field is not a URL', async function () {
      const { trx } = this;
      const job = new Job({ requestId: uuid().toString(), username: 'jdoe', request: 'foo:not//a-url' } as JobRecord);
      await expect(job.save(trx)).to.eventually.be.rejected;
    });
  });
});
