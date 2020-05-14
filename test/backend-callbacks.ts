import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import url from 'url';
import { Job } from 'models/job';
import { truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { getNextCallback } from '../example/http-backend';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import db from '../app/util/db';

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
      request(this.backend).post(this.callback).query({ status: 'successful' }),
    ]);
  });
}

describe('Backend Callbacks', function () {
  const collection = 'C1104-PVC_TS2';

  hookServersStartStop();

  beforeEach(truncateAll);
  after(truncateAll);

  describe('for synchronous requests with asynchronous-style backend responses', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection }).ok(() => true);
    });

    describe('when the service does not provide any results', function () {
      beforeEach(async function () {
        await request(this.backend).post(this.callback).query({ status: 'successful' });
        this.userResp = await this.userPromise;
      });

      it('sends a synchronous failure explaining that there were no results', async function () {
        expect(this.userResp.statusCode).to.equal(500);
        expect(this.userResp.text).to.include('The backend service provided 0 outputs when 1 was required');
      });
    });

    describe('when the service provides exactly one result', function () {
      beforeEach(async function () {
        this.serviceResponse = await request(this.backend).post(this.callback).query({ item: { href: 'https://example.com/1' } });
        await request(this.backend).post(this.callback).query({ status: 'successful' });
        this.userResp = await this.userPromise;
      });

      it('redirects to the result', function () {
        expect(this.userResp.statusCode).to.eql(303);
        expect(this.userResp.headers.location).to.eql('https://example.com/1');
      });
    });

    describe('when the service provides multiple results', function () {
      beforeEach(async function () {
        this.serviceResponse = await request(this.backend).post(this.callback).query({ item: { href: 'https://example.com/1' } });
        this.serviceResponse = await request(this.backend).post(this.callback).query({ item: { href: 'https://example.com/2' } });
        await request(this.backend).post(this.callback).query({ status: 'successful' });
        this.userResp = await this.userPromise;
      });

      it('sends a synchronous failure explaining that there were too many results', function () {
        expect(this.userResp.statusCode).to.equal(500);
        expect(this.userResp.text).to.include('The backend service provided 2 outputs when 1 was required');
      });
    });

    describe('when the service sends an error', function () {
      beforeEach(async function () {
        await request(this.backend).post(this.callback).query({ error: 'backend error message' });
        this.userResp = await this.userPromise;
      });

      it('sends a synchronous failure containing the error message', function () {
        expect(this.userResp.statusCode).to.equal(400);
        expect(this.userResp.text).to.include('backend error message');
      });
    });
  });

  describe('for asynchronous requests', function () {
    hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', {}); });

    describe('temporal validation', function () {
      it('rejects temporal params containing invalid dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,broken' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('rejects temporal params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
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
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('rejects bbox params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
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
