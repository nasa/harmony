const { expect } = require('chai');
const { describe, it } = require('mocha');
const { hookServersStartStop } = require('../helpers/servers');
// const request = require('supertest');

const job = {
  todo: 'todo',
};

describe('Individual job status route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  const jobId = 'the-job-id';
  describe('For a user who is not logged in', function () {
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(307);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobId}`));
    });
  });

  describe('For a logged-in user who owns the job', function () {
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns a single job record in JSON format', function () {
      expect(JSON.parse(this.res.text)).to.equal(job);
    });
  });

  describe('For a logged-in user who does not own the job', function () {
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      expect(JSON.parse(this.res.text)).to.equal({ error: 'Oh no.' });
    });
  });

  describe('For a non-existent job ID', function () {
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      expect(JSON.parse(this.res.text)).to.equal({ error: 'Oh no.' });
    });
  });

  describe('For an invalid job ID format', function () {
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      expect(JSON.parse(this.res.text)).to.equal({ error: 'Oh no.' });
    });
  });
});
