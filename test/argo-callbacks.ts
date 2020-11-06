import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import url from 'url';
import Sinon, { SinonStub } from 'sinon';
import { Job, JobStatus } from 'models/job';
import { HTTPError } from 'superagent';
import { truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { getNextCallback } from '../example/http-backend';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import db from '../app/util/db';
import { hookJobCreationEach } from './helpers/jobs';
import { getObjectText } from './helpers/object-store';
import { objectStoreForProtocol, S3ObjectStore } from '../app/util/object-store';

/**
 * Adds before / after hooks calling the http backend service, awaiting the initial invocation,
 * and making sure the request completes in the after hook.  `this.userPromise` is a promise to
 * the HTTP response to the Harmony request made by `fn`.  `this.callback` is the callback URL
 * for the service request.
 * @param {() => Promise<Test>} fn A function that makes a Harmony request, returning a promise
 *   for its result
 * @returns {void}
 */
function hookHttpBackendEach(fn): void {
  beforeEach(async function () {
    const callbackPromise = getNextCallback();
    this.userPromise = fn.call(this);
    this.userPromise.then(); // The supertest request won't get sent until `then` is called
    const callbackRoot = await callbackPromise;
    this.callback = `${new url.URL(callbackRoot).pathname}/response`;
  });

  afterEach(async function () {
    // Both of these should succeed, but their sequence depends on async vs sync, so use Promise.all
    await Promise.all([
      this.userPromise,
      request(this.backend).post(this.callback).query({ status: 'successful', argo: 'true' }),
    ]);
  });
}

/**
 * Adds a beforeEach hook to provide a callback and await its processing
 *
 * @param fn A function that takes a callback request and returns it augmented with any query
 *   params, post bodies, etc
 * @param finish True if the hook should wait for the user request to finish
 */
function hookCallbackEach(fn: (req: request.Test) => request.Test, finish = false): void {
  beforeEach(async function () {
    this.callbackRes = await fn(request(this.backend).post(this.callback));
    if (finish) {
      this.userResp = await this.userPromise;
    }
  });
}

/**
 * Loads the job for the provided callback URL
 * @param callback - the callback URL for the job that needs to be loaded
 */
async function loadJobForCallback(callback: string): Promise<Job> {
  const requestId = callback.replace('/response', '').split('/').pop();
  return Job.byRequestId(db, requestId);
}

describe('Argo Callbacks', function () {
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
  describe('Update progress', function () {

  });

  // temporal validate

  // bbox validation

  // type set correctly on link

  describe('Argo progress callbacks', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection }).ok(() => true);
    });

    describe('for asynchronous requests', function () {
      hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', {}); });

      describe('when a POST body item is received', function () {
        hookCallbackEach((r) => r
          .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
          .send('Some data here'), true);

        it('does not alter the corresponding job status', async function () {
          const job = await loadJobForCallback(this.callback);
          expect(job.isComplete()).to.equal(false);
        });

        it('provides a link in the job to the stored response content', async function () {
          const job = await loadJobForCallback(this.callback);
          const link = job.getRelatedLinks('data')[0];
          expect(link.href).to.match(/\/some-file.nc$/);
          expect(await getObjectText(link.href.replace('signed+', ''))).to.equal('Some data here');
        });
      });

      describe('temporal validation', function () {
        it('rejects temporal params containing invalid dates', async function () {
          const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,broken' } });
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
          const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z' } });
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
          const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
          expect(response.status).to.equal(200);
        });

        it('saves parsed temporal params to the database', async function () {
          await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data').length).to.equal(1);
          expect(job.getRelatedLinks('data')[0].temporal).to.eql({ start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
        });
      });

      describe('bbox validation', function () {
        hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', {}); });

        it('rejects bbox params containing invalid numbers', async function () {
          const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,broken,3.3' } });
          const error = JSON.parse((response.error as HTTPError).text);
          expect(response.status).to.equal(400);
          expect(error).to.eql({
            code: 'harmony.RequestValidationError',
            message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North',
          });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data')).to.eql([]);
        });

        it('rejects bbox params containing an incorrect number of dates', async function () {
          const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2' } });
          const error = JSON.parse((response.error as HTTPError).text);
          expect(response.status).to.equal(400);
          expect(error).to.eql({
            code: 'harmony.RequestValidationError',
            message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North',
          });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data')).to.eql([]);
        });

        it('accepts bbox params containing the correct number of dates', async function () {
          const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
          expect(response.status).to.equal(200);
        });

        it('saves parsed bbox params to the database', async function () {
          await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
          const job = (await Job.forUser(db, 'anonymous')).data[0];
          expect(job.getRelatedLinks('data').length).to.equal(1);
          expect(job.getRelatedLinks('data')[0].bbox).to.eql([0.0, 1.1, 2.2, 3.3]);
        });
      });
    });
  });
});
