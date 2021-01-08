import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import Sinon, { SinonStub } from 'sinon';
import { Job } from 'models/job';
import { HTTPError } from 'superagent';
import { truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import db from '../app/util/db';
import { S3ObjectStore } from '../app/util/object-store';
import { hookArgoCallbackEach, hookHttpBackendEach, loadJobForCallback } from './helpers/callbacks';

describe('Argo Callbacks', function () {
  // Seeing frequent timeouts in CI environment for this test with the default 2 second timeout
  this.timeout(10000);
  const collection = 'C1104-PVC_TS2';

  hookServersStartStop();

  beforeEach(function () {
    // Avoid signing objects, which mock-aws-s3 cannot do the way we need it to
    Sinon.stub(S3ObjectStore.prototype, 'signGetObject')
      .callsFake(async (s3Uri) => `signed+${s3Uri}`);
  });

  afterEach(function () {
    (S3ObjectStore.prototype.signGetObject as SinonStub).restore();
  });

  beforeEach(truncateAll);
  after(truncateAll);

  // test progress is updated correctly
  describe('when the result handler sends a batch completion notice', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection }).ok(() => true);
    });

    describe('and the callback contains completion data', function () {
      hookArgoCallbackEach((r) => r.send({ batch_completed: 'true', batch_count: '4', post_batch_step_count: '0' }));
      it('sets the job progress correctly', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.progress).to.equal(25);
      });
    });

    describe('and the callback contains completed items', function () {
      describe('and the callback contains an item with an href parameter', function () {
        hookArgoCallbackEach((r) => r
          .send({
            batch_completed: 'true',
            batch_count: '4',
            post_batch_step_count: '0',
            items: [{
              href: 'https://example.com/1',
              title: 'another-file.nc',
            }],
          }));

        it('stores the link to the provided item', async function () {
          const job = await loadJobForCallback(this.callback);
          expect(job.getRelatedLinks('data')[0].href).to.equal('https://example.com/1');
        });
      });

      describe('and the items contain a temporal range', function () {
        it('rejects temporal params containing invalid dates', async function () {
          const response = await request(this.backend).post(this.argoCallback).type('form')
            .send({
              batch_completed: 'true',
              batch_count: '4',
              post_batch_step_count: '0',
              items: [{
                href: 'https://example.com/1',
                title: 'another-file.nc',
                temporal: '2020-01-01T00:00:00Z,broken',
              }],
            });
          const error = JSON.parse((response.error as HTTPError).text);
          expect(response.status).to.equal(400);
          expect(error).to.eql({
            code: 'harmony.RequestValidationError',
            message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End',
          });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data')).to.eql([]);
        });

        it('rejects temporal params containing an incorrect number of dates', async function () {
          const response = await request(this.backend).post(this.argoCallback).type('form')
            .send({
              batch_completed: 'true',
              batch_count: '4',
              post_batch_step_count: '0',
              items: [{
                href: 'https://example.com/1',
                title: 'another-file.nc',
                temporal: '2020-01-01T00:00:00Z',
              }],
            });
          const error = JSON.parse((response.error as HTTPError).text);
          expect(response.status).to.equal(400);
          expect(error).to.eql({
            code: 'harmony.RequestValidationError',
            message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End',
          });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data')).to.eql([]);
        });

        it('accepts temporal params containing the correct number of dates', async function () {
          const response = await request(this.backend).post(this.argoCallback).type('form')
            .send({
              batch_completed: 'true',
              batch_count: '4',
              post_batch_step_count: '0',
              items: [{
                href: 'https://example.com/1',
                title: 'another-file.nc',
                temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z',
              }],
            });
          expect(response.status).to.equal(200);
        });

        it('saves parsed temporal params to the database', async function () {
          await request(this.backend).post(this.argoCallback).type('form')
            .send({
              batch_completed: 'true',
              batch_count: '4',
              post_batch_step_count: '0',
              items: [{
                href: 'https://example.com/1',
                title: 'another-file.nc',
                temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z',
              }],
            });

          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data').length).to.equal(1);
          expect(job.getRelatedLinks('data')[0].temporal).to.eql({ start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
        });
      });
    });

    describe('and the items contain a bbox', function () {
      hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', {}); });

      it('rejects bbox params containing invalid numbers', async function () {
        const response = await request(this.backend).post(this.argoCallback).type('form')
          .send({
            batch_completed: 'true',
            batch_count: '4',
            post_batch_step_count: '0',
            items: [{
              href: 'https://example.com/1',
              title: 'another-file.nc',
              bbox: [0.0, 1.1, 'broken', 3.3],
            }],
          });
        const error = JSON.parse((response.error as HTTPError).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({
          code: 'harmony.RequestValidationError',
          message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North',
        });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('rejects bbox params containing an incorrect number of values', async function () {
        const response = await request(this.backend).post(this.argoCallback).type('form')
          .send({
            batch_completed: 'true',
            batch_count: '4',
            post_batch_step_count: '0',
            items: [{
              href: 'https://example.com/1',
              title: 'another-file.nc',
              bbox: [0.0, 1.1, 3.3],
            }],
          });
        const error = JSON.parse((response.error as HTTPError).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({
          code: 'harmony.RequestValidationError',
          message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North',
        });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('accepts bbox params containing the correct number of values', async function () {
        const response = await request(this.backend).post(this.argoCallback).type('form')
          .send({
            batch_completed: 'true',
            batch_count: '4',
            post_batch_step_count: '0',
            items: [{
              href: 'https://example.com/1',
              title: 'another-file.nc',
              bbox: [0.0, 1.1, 2.2, 3.3],
            }],
          });
        expect(response.status).to.equal(200);
      });

      it('saves parsed bbox params to the database', async function () {
        await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data').length).to.equal(1);
        expect(job.getRelatedLinks('data')[0].bbox).to.eql([0.0, 1.1, 2.2, 3.3]);
      });
    });

    describe('and the callback contains multiple items', function () {
      hookArgoCallbackEach((r) => r
        .send({
          batch_completed: 'true',
          batch_count: '4',
          post_batch_step_count: '0',
          items: [{
            href: 'https://example.com/1',
            title: '1-another-file.nc',
          },
          {
            href: 'https://example.com/2',
            title: '2-another-file.nc',
          }],
        }));

      it('stores the links to the provided items', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.getRelatedLinks('data')[0].href).to.equal('https://example.com/1');
        expect(job.getRelatedLinks('data')[1].href).to.equal('https://example.com/2');
      });
    });
  });

  describe('for callbacks where a corresponding job cannot be found', function () {
    beforeEach(async function () {
      this.res = await request(this.backend).post('/service/missing-thing/argo-response').type('form');
    });

    it('replies with a 404 error to the backend service', function () {
      expect(this.res.statusCode).to.equal(404);
    });
  });
});
