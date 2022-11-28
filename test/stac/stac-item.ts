import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import itReturnsTheExpectedStacResponse from '../helpers/stac-item';
import { buildJob } from '../helpers/jobs';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { stacItem, hookStacItem } from '../helpers/stac';
import { JobStatus } from '../../app/models/job';

const runningJob = buildJob({
  username: 'joe',
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
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  }],
  request: 'http://example.com/harmony?job=runningJob',
});

const completedJob = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  message: 'it is done',
  progress: 100,
  numInputGranules: 5,
  links: [{
    href: 's3://example-bucket/public/example/path1.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  },
  {
    href: 's3://example-bucket/public/example/path2.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  }],
  request: 'http://example.com/harmony?job=completedJob',
});

const completedNonStacJob = buildJob({
  username: 'joe',
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
});

describe('STAC item route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await runningJob.save(this.trx);
    await completedJob.save(this.trx);
    await completedNonStacJob.save(this.trx);
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

  describe('For a non-existent job ID', function () {
    const unknownRequest = uuid();
    hookStacItem(unknownRequest, 0, 'joe');
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
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
        code: 'harmony.RequestValidationError',
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
          code: 'harmony.ConflictError',
          description: `Error: Job ${jobId} is not complete`,
        });
      });
    });

    describe('when the job is complete', function () {
      describe('when the service does not supply the necessary fields', async function () {
        const completedJobId = completedNonStacJob.requestId;
        hookStacItem(completedJobId, 0, 'joe');

        it('returns an HTTP not found response', function () {
          expect(this.res.statusCode).to.equal(404);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.NotFoundError',
            description: `Error: Service did not provide STAC items for job ${completedJobId}`,
          });
        });
      });

      describe('when the service supplies the necessary fields for the 0th item', async function () {
        const completedJobId = completedJob.requestId;

        const expectedItemWithoutAssetsOrLinks = {
          id: `${completedJob.requestId}_0`,
          stac_version: '1.0.0',
          title: `Harmony output #0 in job ${completedJob.requestId}`,
          description: 'Harmony out for http://example.com/harmony?job=completedJob',
          type: 'Feature',
          stac_extensions: [
            'https://stac-extensions.github.io/timestamps/v1.0.0/schema.json',
          ],

          bbox: [-10, -10, 10, 10],
          geometry: { type: 'Polygon', coordinates: [[[-10, -10], [-10, 10], [10, 10], [10, -10], [-10, -10]]] },
          // `links` added later
          properties: {
            // `created` and `expires` properties added later
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
          hookStacItem(completedJobId, 0, 'joe', { linkType: 's3' });
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            's3',
          );
        });

        // HARMONY-770 AC 6
        describe('when linkType is http', function () {
          hookStacItem(completedJobId, 0, 'joe', { linkType: 'http' });
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            'http',
          );
        });

        // HARMONY-770 AC 6
        describe('when linkType is https', function () {
          hookStacItem(completedJobId, 0, 'joe', { linkType: 'https' });
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
            'https',
          );
        });
      });

      describe('when the service supplies the necessary fields for the nth item', async function () {
        const completedJobId = completedJob.requestId;
        const expectedItemWithoutAssetsOrLinks = {
          id: `${completedJob.requestId}_1`,
          stac_version: '1.0.0',
          title: `Harmony output #1 in job ${completedJob.requestId}`,
          description: 'Harmony out for http://example.com/harmony?job=completedJob',
          type: 'Feature',
          stac_extensions: [
            'https://stac-extensions.github.io/timestamps/v1.0.0/schema.json',
          ],
          bbox: [-10, -10, 10, 10],
          geometry: { type: 'Polygon', coordinates: [[[-10, -10], [-10, 10], [10, 10], [10, -10], [-10, -10]]] },
          // `links` added later
          properties: {
            // `created` and `expires` properties added later
            license: 'various',
            start_datetime: '2020-01-01T00:00:00.000Z',
            end_datetime: '2020-01-01T01:00:00.000Z',
            datetime: '2020-01-01T00:00:00.000Z',
          },
        };

        describe('when the nth item is requested', function () {
          hookStacItem(completedJobId, 1, 'joe');
          itReturnsTheExpectedStacResponse(
            completedJob,
            expectedItemWithoutAssetsOrLinks,
          );
        });
      });

      describe('when the linkType is invalid', function () {
        const completedJobId = completedJob.requestId;
        hookStacItem(completedJobId, 0, 'joe', { linkType: 'foo' });
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
            code: 'harmony.RequestValidationError',
            description: 'Error: STAC item index is out of bounds',
          });
        });
      });
    });
  });
});
