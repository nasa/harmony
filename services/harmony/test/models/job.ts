import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { buildJob } from '../helpers/jobs';
import { Job, JobRecord, JobStatus } from '../../app/models/job';
import JobLink from '../../app/models/job-link';
import { hookTransactionEach } from '../helpers/db';

const exampleProps = {
  username: 'joe',
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [{ href: 'http://example.com', rel: 'data' }],
  request: 'http://example.com/harmony?foo=bar',
  numInputGranules: 100,
  collectionIds: [],
};

const requestId = uuid().toString();
const examplePropsWithIds: JobRecord = {
  ...exampleProps,
  requestId,
  jobID: requestId,
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

    describe('.byUsernameAndJobID', function () {
      let job;
      beforeEach(async function () {
        job = buildJob({ username: 'jdoe' });
        await job.save(this.trx);
      });

      describe('when a job matches the username and job ID', function () {
        it('returns the matching job', async function () {
          const result = await Job.byUsernameAndJobID(this.trx, 'jdoe', job.jobID);
          expect(result.job.id).to.eql(job.id);
        });
      });

      describe('when the username has a job but the job ID does not match', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndJobID(this.trx, 'jdoe', uuid());
          expect(result.job).to.eql(null);
        });
      });

      describe('when the job ID exists but the username does not match', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndJobID(this.trx, 'notjdoe', job.jobID);
          expect(result.job).to.eql(null);
        });
      });

      describe('when neither the username nor job ID are matches', function () {
        it('returns null', async function () {
          const result = await Job.byUsernameAndJobID(this.trx, 'notjdoe', uuid());
          expect(result.job).to.eql(null);
        });
      });
    });
  });

  describe('#constructor', function () {
    it('copies passed fields to the job object', function () {
      const props = { id: 1234, ...examplePropsWithIds };
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

    it('defaults links to an empty array', function () {
      expect(new Job({} as JobRecord).links).to.eql([]);
    });
  });

  describe('#save', function () {
    hookTransactionEach();

    it('inserts new records', async function () {
      const job = buildJob(exampleProps);
      await job.save(this.trx);
      const result = await Job.byJobID(this.trx, job.jobID, true);
      for (const key of Object.keys(exampleProps)) {
        if (key === 'links') {
          expect(job[key].map((l) => l.serialize())).to.eql(job.links.map((l) => l.serialize()));
          for (const link of job[key]) {
            const keys = Object.keys(link);
            expect(keys).to.include('id');
            expect(keys).to.include('jobID');
            expect(keys).to.include('createdAt');
            expect(keys).to.include('updatedAt');
          }
        } else {
          expect(job[key]).to.eql(exampleProps[key]);
        }
      }
      expect(result.job.id).to.eql(job.id);
    });

    it('updates existing records', async function () {
      const job = buildJob(exampleProps);
      await job.save(this.trx);
      job.username = 'notjdoe';
      await job.save(this.trx);
      const result = await Job.byJobID(this.trx, job.jobID, true);
      expect(result.job.username).to.eql('notjdoe');
    });

    it('sets the id field of new records', async function () {
      const job = buildJob(exampleProps);
      await job.save(this.trx);
      expect(job.id).to.be;
    });

    it('saves changes to the links array', async function () {
      let job = buildJob(exampleProps);
      await job.save(this.trx);
      ({ job } = await Job.byJobID(this.trx, job.jobID, true));
      job.links.push(new JobLink({ href: 'http://example.com/2', jobID: job.jobID }));
      await job.save(this.trx);
      const result = await Job.byJobID(this.trx, job.jobID, true);
      expect(result.job.links.map((l) => l.serialize()))
        .to.eql(job.links.map((l) => l.serialize()));
    });

    it('throws an error when progress is outside of the allowable range', async function () {
      const { trx } = this;
      const job = buildJob({ username: 'jdoe', requestId: uuid().toString(), progress: 101 } as JobRecord);
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
      const job = buildJob({ requestId: uuid().toString(), username: 'jdoe', request: 'foo:not//a-url' } as JobRecord);
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('truncates long error messages', async function () {
      let job = buildJob(exampleProps);
      const longFailureMessage = 'x'.repeat(6000);
      job.setMessage(longFailureMessage, JobStatus.FAILED);
      await job.save(this.trx);
      ({ job } = await Job.byJobID(this.trx, job.jobID, true));
      expect(job.getMessage(JobStatus.FAILED).length).lessThanOrEqual(4096 - 1000);
    });
  });
});
