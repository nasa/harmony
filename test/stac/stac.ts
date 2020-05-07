import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import Job from 'models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { stacCatalog, hookStacCatalog } from '../helpers/stac';

const runningJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: 'running',
  message: 'it is running',
  progress: 42,
  links: [{
    href: 'http://example.com',
    type: 'application/octet-stream',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: '2020-01-01T00:00:00.000Z',
      end: '2020-01-01T01:00:00.000Z',
    },
  }],
  request: 'http://example.com/harmony?job=runningJob',
};

const completedJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: 'successful',
  message: 'it is done',
  progress: 100,
  links: [{
    href: 'http://example.com',
    type: 'application/octet-stream',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: '2020-01-01T00:00:00.000Z',
      end: '2020-01-01T01:00:00.000Z',
    },
  }],
  request: 'http://example.com/harmony?job=completedJob',
};

describe('STAC catalog route', function () {
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
      this.res = await stacCatalog(this.frontend, jobId).redirects(0);
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
    hookStacCatalog(jobId, 'jill');
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
    hookStacCatalog(unknownRequest, 'joe');
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
    hookStacCatalog('not-a-uuid', 'joe');
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
      hookStacCatalog(jobId, 'joe');
      it('returns an HTTP not implemented response', function () {
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
      describe('when the service supplies the necessary fields', async function () {
        const completedJobId = completedJob.requestId;
        hookStacCatalog(completedJobId, 'joe');

        it('returns an HTTP OK response', function () {
          expect(this.res.statusCode).to.equal(200);
        });

        it('returns a STAC catalog in JSON format', function () {
          const catalog = JSON.parse(this.res.text);
          expect(catalog.description).to.equal('Harmony output for http://example.com/harmony?job=completedJob');
          expect(catalog.id).to.equal(completedJob.requestId);
          expect(catalog.links).to.eql([
            { href: '.', rel: 'self', title: 'self' },
            { href: '.', rel: 'root', title: 'root' },
            { href: './0', rel: 'item' },
          ]);
          expect(catalog.stac_version).to.equal('0.9.0');
          expect(catalog.title).to.include('Harmony output for ');
        });
      });
    });
  });
});
