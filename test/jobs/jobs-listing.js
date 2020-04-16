const { expect } = require('chai');
const { describe, it, before } = require('mocha');
const uuid = require('uuid');
const { hookServersStartStop } = require('../helpers/servers');
const { hookTransaction, hookTransactionFailure } = require('../helpers/db');
const { containsJob, jobListing, hookJobListing } = require('../helpers/jobs');
const Job = require('../../app/models/job');

// Example jobs to use in tests
const woodyJob1 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'successful',
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1' }],
  request: 'http://example.com/harmony?request=woody1',
};

const woodyJob2 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 60,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
};

const buzzJob1 = {
  username: 'buzz',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 30,
  links: [],
  request: 'http://example.com/harmony?request=buzz1',
};

describe('Jobs listing route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await jobListing(this.frontend).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/jobs'));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      // Add all jobs to the database
      await new Job(woodyJob1).save(this.trx);
      await new Job(woodyJob2).save(this.trx);
      await new Job(buzzJob1).save(this.trx);
      this.trx.commit();
    });

    describe('Who has no jobs', function () {
      hookJobListing({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty JSON job list', function () {
        expect(JSON.parse(this.res.text)).to.eql([]);
      });
    });

    describe('Who has jobs', function () {
      hookJobListing({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a list of the user’s job records in JSON format', function () {
        const listing = JSON.parse(this.res.text);
        console.log(this.res.text);
        expect(containsJob(woodyJob1, listing)).to.be.true;
        expect(containsJob(woodyJob2, listing)).to.be.true;
      });
      it('does not return jobs for other users', function () {
        const listing = JSON.parse(this.res.text);
        expect(containsJob(buzzJob1, listing)).to.be.false;
      });
    });
  });
  describe('When the database catches fire', function () {
    hookTransactionFailure();
    hookJobListing({ username: 'woody' });
    describe('for a user that should have jobs', function () {
      it('returns an internal server error status code', function () {
        expect(this.res.statusCode).to.equal(500);
      });
      it('includes an error message in JSON format indicating a server error', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:ServerError',
          description: 'Error: Internal server error trying to retrieve jobs listing',
        });
      });
    });
  });
});
