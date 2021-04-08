import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import itReturnsTheExpectedStacResponse from 'test/helpers/stac-item';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { stacItem, hookStacItem } from '../helpers/stac';
import { Job, JobStatus } from '../../app/models/job';

const runningJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  numInputGranules: 100,
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
  status: JobStatus.SUCCESSFUL,
  message: 'it is done',
  progress: 100,
  numInputGranules: 5,
  links: [{
    href: 's3://example-bucket/public/example/path.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: '2020-01-01T00:00:00.000Z',
      end: '2020-01-01T01:00:00.000Z',
    },
  }],
  request: 'http://example.com/harmony?job=completedJob',
};

const completedNonStacJob = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.SUCCESSFUL,
  message: 'it is done',
  progress: 100,
  numInputGranules: 12,
  links: [{
    href: 'http://example.com',
    type: 'application/octet-stream',
    rel: 'data',
  }],
  request: 'http://example.com/harmony?job=completedJob',
};

describe('STAC item route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await new Job(runningJob).save(this.trx);
    await new Job(completedJob).save(this.trx);
    await new Job(completedNonStacJob).save(this.trx);
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
        const completedJobId = completedNonStacJob.requestId;
        hookStacItem(completedJobId, 0, 'joe');

        it('returns an HTTP not implemented response', function () {
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
        const expectedItemWithoutAssetsOrLinks = {
          id: `${completedJob.requestId}_0`,
          stac_version: '0.9.0',
          title: `Harmony output #0 in job ${completedJob.requestId}`,
          description: 'Harmony out for http://example.com/harmony?job=completedJob',
          type: 'Feature',
          bbox: [-10, -10, 10, 10],
          geometry: { type: 'Polygon', coordinates: [[[-10, -10], [-10, 10], [10, 10], [10, -10], [-10, -10]]] },
          // `links` added later
          properties: {
            // `created` property added later,
            license: 'various',
            start_datetime: '2020-01-01T00:00:00.000Z',
            end_datetime: '2020-01-01T01:00:00.000Z',
            datetime: '2020-01-01T00:00:00.000Z',
          },
        };

        // HARMONY-770 AC 2
        describe('when linkType is not set', function () {
          hookStacItem(completedJobId, 0, 'joe');
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
          );
        });

        // HARMONY-770 AC 7
        describe('when linkType is s3', function () {
          hookStacItem(completedJobId, 0, 'joe', 's3');
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            's3',
          );
        });

        // HARMONY-770 AC 6
        describe('when linkType is http', function () {
          hookStacItem(completedJobId, 0, 'joe', 'http');
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            'http',
          );
        });

        // HARMONY-770 AC 6
        describe('when linkType is https', function () {
          hookStacItem(completedJobId, 0, 'joe', 'https');
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            'https',
          );
        });
      });

      describe('when the linkType is invalid', function () {
        const completedJobId = completedJob.requestId;
        hookStacItem(completedJobId, 0, 'joe', 'foo');
        // HARMONY-770 AC 8
        it('returns a 400 status', function () {
          expect(this.res.error.status).to.equal(400);
        });
        it('returns an informative error', function () {
          expect(this.res.error.text).to.match(/^{"code":"harmony.RequestValidationError","description":"Error: Invalid linkType 'foo' must be http, https, or s3"}/);
        });
      });

      describe('when the item index is out of bounds', function () {
        const completedJobId = completedJob.requestId;
        hookStacItem(completedJobId, 100, 'joe');
        it('returns an HTTP bad request response', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony:RequestError',
            description: 'Error: STAC item index is out of bounds',
          });
        });
      });
    });
  });
});
