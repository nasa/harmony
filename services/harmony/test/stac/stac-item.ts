import { expect } from 'chai';
import { before, describe, it } from 'mocha';
import { v4 as uuid } from 'uuid';

import { JobStatus } from '../../app/models/job';
import { hookTransaction } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import hookServersStartStop from '../helpers/servers';
import { hookStacItem } from '../helpers/stac';
import itReturnsTheExpectedStacResponse from '../helpers/stac-item';

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
    href: 's3://example-bucket/public/example-job-id/work-item-id/path1.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  },
  {
    href: 's3://example-bucket/public/example-job-id/work-item-id/path2.tif',
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

const completedJobWithDestinationUrl = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  destination_url: 's3://my-staging-bucket',
  message: 'it is done',
  progress: 100,
  numInputGranules: 1,
  links: [{
    href: 's3://example-bucket/public/example-job-id/work-item-id/path1.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  },
  {
    href: 's3://example-bucket/public/example-job-id/work-item-id/path2.tif',
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
  links: [],
  request: 'http://example.com/harmony?job=completedJob',
});

describe('STAC item route', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });
  hookTransaction();
  before(async function () {
    await runningJob.save(this.trx);
    await completedJob.save(this.trx);
    await completedJobWithDestinationUrl.save(this.trx);
    await completedNonStacJob.save(this.trx);
    this.trx.commit();
  });
  const jobId = runningJob.requestId;

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
        description: `Error: Unable to find job ${unknownRequest}`,
      });
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

  const tests = [{
    description: 'with a logged-in user who owns the job',
    userName: 'joe',
  }, {
    description: 'with a guest user who does not own the job',
    userName: null,
  }];
  for (const test of tests) {
    describe(test.description, function () {
      describe('when the job is incomplete', function () {
        hookStacItem(jobId, 0, test.userName);
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

      describe('When the job is complete and has a destination url set', async function () {
        const completedJobId = completedJobWithDestinationUrl.requestId;

        describe('when an item is requested', function () {
          hookStacItem(completedJobId, 0, test.userName);

          it('returns a STAC item without an "expires" field', async function () {
            const item = JSON.parse(this.res.text);
            expect(item.properties.expires).to.be.undefined;
          });
        });
      });

      describe('when the job is complete', function () {
        describe('when the service does not supply the necessary fields', async function () {
          const completedJobId = completedNonStacJob.requestId;
          hookStacItem(completedJobId, 0, test.userName);

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
            hookStacItem(completedJobId, 0, test.userName);
            itReturnsTheExpectedStacResponse(
              completedJob,
              expectedItemWithoutAssetsOrLinks,
            );
          });

          // HARMONY-770 AC 7
          describe('when linkType is s3', function () {
            hookStacItem(completedJobId, 0, test.userName, { linkType: 's3' });
            itReturnsTheExpectedStacResponse(
              completedJob,
              expectedItemWithoutAssetsOrLinks,
              's3',
            );
          });

          // HARMONY-770 AC 6
          describe('when linkType is http', function () {
            hookStacItem(completedJobId, 0, test.userName, { linkType: 'http' });
            itReturnsTheExpectedStacResponse(
              completedJob,
              expectedItemWithoutAssetsOrLinks,
              'http',
            );
          });

          // HARMONY-770 AC 6
          describe('when linkType is https', function () {
            hookStacItem(completedJobId, 0, test.userName, { linkType: 'https' });
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
            hookStacItem(completedJobId, 1, test.userName);
            itReturnsTheExpectedStacResponse(
              completedJob,
              expectedItemWithoutAssetsOrLinks,
            );
          });
        });

        describe('when the linkType is invalid', function () {
          const completedJobId = completedJob.requestId;
          hookStacItem(completedJobId, 0, test.userName, { linkType: 'foo' });
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
          hookStacItem(completedJobId, 100, test.userName);
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
  }
});
