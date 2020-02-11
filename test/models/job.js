const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const uuid = require('uuid');
const { hookTransactionEach } = require('../helpers/db');
const Job = require('../../app/models/job');

const exampleProps = {
  username: 'joe',
  requestId: uuid().toString(),
  status: 'running',
  message: 'it is running',
  progress: 42,
  links: [{ href: 'http://example.com' }],
};

describe('Job', function () {
  describe('retrieval methods', function () {
    hookTransactionEach();
    beforeEach(async function () {
      // Add records to the job table that should not be returned
      await new Job({ username: 'dummy', requestId: uuid().toString() }).save(this.trx);
      await new Job({ username: 'dummy', requestId: uuid().toString() }).save(this.trx);
    });

    describe('.forUser', function () {
      describe('when a user has jobs', function () {
        let jobs;
        beforeEach(async function () {
          jobs = [
            new Job({ username: 'jdoe', requestId: uuid().toString() }),
            new Job({ username: 'jdoe', requestId: uuid().toString() }),
          ];
          await Promise.all([jobs[0].save(this.trx), jobs[1].save(this.trx)]);
        });

        it("returns the user's jobs", async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          const requestIds = results.map((r) => r.requestId);
          expect(requestIds).to.include(jobs[0].requestId);
          expect(requestIds).to.include(jobs[1].requestId);
        });

        it("does not return other users' jobs", async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          const usernames = results.map((r) => r.username);
          expect(usernames).to.eql(['jdoe', 'jdoe']);
        });
      });

      describe('when a user has no jobs', async function () {
        it('returns an empty array', async function () {
          const results = await Job.forUser(this.trx, 'jdoe');
          expect(results).to.eql([]);
        });
      });
    });

    describe('.byUsernameAndRequestId', function () {
      let job;
      beforeEach(async function () {
        job = new Job({ username: 'jdoe', requestId: uuid().toString() });
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
        job = new Job({ username: 'jdoe', requestId: uuid().toString() });
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
        job = new Job({ username: 'jdoe', requestId: uuid().toString() });
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
  });

  describe('#constructor', function () {
    it('copies passed fields to the job object', function () {
      const props = { id: 1234, exampleProps };
      const job = new Job(props);
      for (const key of Object.keys(props)) {
        expect(job[key]).to.eql(props[key]);
      }
    });

    it('defaults status to "accepted"', function () {
      expect(new Job({}).status).to.eql('accepted');
    });

    it('defaults progress to 0', function () {
      expect(new Job({}).progress).to.eql(0);
    });

    it('defaults message to the status', function () {
      expect(new Job({ status: 'failed' }).message).to.eql('failed');
    });

    it('defaults links to an empty array', function () {
      expect(new Job({}).links).to.eql([]);
    });

    it('parses _json_links into the .links property', function () {
      expect(new Job({ _json_links: '[{"href":"https://example.com"}]' }).links)
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
      job.links.push({ href: 'http://example.com/2' });
      await job.save(this.trx);
      const result = await Job.byRequestId(this.trx, job.requestId);
      expect(result.links).to.eql(job.links);
    });

    it('throws an error when progress is outside of the allowable range', async function () {
      const { trx } = this;
      const job = new Job({ username: 'jdoe', requestId: uuid().toString(), progress: 101 });
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('throws an error when username is not provided', async function () {
      const { trx } = this;
      const job = new Job({ username: 'jdoe' });
      await expect(job.save(trx)).to.eventually.be.rejected;
    });

    it('throws an error when requestId is not provided', async function () {
      const { trx } = this;
      const job = new Job({ requestId: uuid().toString() });
      await expect(job.save(trx)).to.eventually.be.rejected;
    });
  });
});
