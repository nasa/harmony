const { expect } = require('chai');
const { describe, it, before } = require('mocha');
const uuid = require('uuid');
const { hookServersStartStop } = require('../helpers/servers');
const { hookTransaction } = require('../helpers/db');
const { stacItem, hookStacItem } = require('../helpers/stac');
const Job = require('../../app/models/job');

const runningJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: 'running',
  message: 'it is running',
  progress: 42,
  links: [{ href: 'http://example.com' }],
  request: 'http://example.com/harmony?job=runningJob',
};

const completedJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: 'successful',
  message: 'it is done',
  progress: 100,
  links: [{ href: 'http://example.com' }],
  request: 'http://example.com/harmony?job=completedJob',
};

const expectedItem = {

};

describe('STAC item route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await new Job(runningJob).save(this.trx);
    await new Job(completedJob).save(this.trx);
    this.trx.commit();
  });
  const jobId = runningJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await stacItem(this.frontend, jobId, 0).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/stac/${jobId}`));
    });
  });

  describe('For a logged-in user who does not own the job', function () {
    hookStacItem(jobId, 0, 'jill');
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony:NotFoundError',
        description: `Error: Unable to find job ${jobId}` });
    });
  });

  describe('For a non-existent job ID', function () {
    const unknownRequest = uuid();
    hookStacItem(unknownRequest, 0, 'joe');
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony:NotFoundError',
        description: `Error: Unable to find job ${unknownRequest}` });
    });
  });

  describe('For an invalid job ID format', function () {
    hookStacItem('not-a-uuid', 0, 'joe');
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony:BadRequestError',
        description: 'Error: jobId not-a-uuid is in invalid format.',
      });
    });
  });

  describe('For a logged-in user who owns the job', function () {
    describe('when the job is incomplete', function () {
      hookStacItem(jobId, 0, 'joe');
      it('returns an HTTP conflict response', function () {
        expect(this.res.statusCode).to.equal(409);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:BadRequestError',
          description: `Error: Job ${jobId} is not complete`,
        });
      });
    });

    describe('when the job is complete', function () {
      describe('when the service does not supply the necessary fields', async function () {
        const completedJobId = completedJob.requestId;
        hookStacItem(completedJobId, 0, 'joe');

        it('returns an HTTP conflict response', function () {
          expect(this.res.statusCode).to.equal(501);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony:ServiceError',
            description: `Error: Service did not provide STAC items for job ${completedJobId}`,
          });
        });
      });

      describe('when the service supplies the necessary fields', async function () {
        const completedJobId = completedJob.requestId;
        hookStacItem(completedJobId, 0, 'joe');

        it('returns an HTTP OK response', function () {
          expect(this.res.statusCode).to.equal(200);
        });

        it('returns a STAC catalog in JSON format', function () {
          const item = JSON.parse(this.res.text);
          expect(item).to.eql(expectedItem);
        });
      });
    });
  });
});
