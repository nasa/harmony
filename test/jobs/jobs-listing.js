const { expect } = require('chai');
const { describe, it, beforeEach } = require('mocha');
const { hookServersStartStop } = require('../helpers/servers');
const { hookTransactionEach } = require('../helpers/db');
const { woodyJob1, woodyJob2, buzzJob1, contains } = require('../helpers/jobs');
const Job = require('../../app/models/job');

describe('Jobs listing route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransactionEach();
  beforeEach(async function () {
    // Add all jobs to the database
    await new Job(woodyJob1).save(this.trx);
    await new Job(woodyJob2).save(this.trx);
    await new Job(buzzJob1).save(this.trx);
  });

  describe('For a user who is not logged in', function () {
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(307);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/jobs'));
    });
  });

  describe('For a logged-in user', function () {
    describe('Who has no jobs', function () {
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty JSON job list', function () {
        expect(JSON.parse(this.res.text)).to.equal({});
      });
    });

    describe('Who has jobs', function () {
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a list of the user’s job records in JSON format', function () {
        const listing = JSON.parse(this.res.text);
        expect(contains(woodyJob1, listing)).to.be.true;
        expect(contains(woodyJob2, listing)).to.be.true;
        expect(listing).to.equal([woodyJob1, woodyJob2]);
      });
      it('does not return jobs for other users', function () {
        const listing = JSON.parse(this.res.text);
        expect(contains(buzzJob1, listing)).to.be.false;
      });
    });
  });
});
