const { expect } = require('chai');
const { describe, it } = require('mocha');
const { hookServersStartStop } = require('../helpers/servers');
// const request = require('supertest');

const woodyJob1 = {
  todo: 'todo',
};

const woodyJob2 = {
  todo: 'for real',
};

const buzzJob1 = {
  todo: 'again',
};

/**
 * Returns true if the object is found in the passed in list
 *
 * @param {Object} obj The object to search for
 * @param {Array} list An array objects
 * @returns {Boolean} true if the object is found
 */
function contains(obj, list) {
  list.forEach((element) => {
    if (element === obj) {
      return true;
    }
    return false;
  });
}

describe('Jobs listing route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

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
