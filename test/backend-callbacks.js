const { describe, it, beforeEach, afterEach, after } = require('mocha');
const { expect } = require('chai');
const request = require('supertest');
const url = require('url');
const { truncateAll } = require('./helpers/db');
const { hookServersStartStop } = require('./helpers/servers');
const { rangesetRequest } = require('./helpers/ogc-api-coverages');

const { getNextCallback } = require('../example/http-backend');
const Job = require('../app/models/job');
const db = require('../app/util/db');

describe('Backend Callbacks', function () {
  const collection = 'C1104-PVC_TS2';

  hookServersStartStop();

  beforeEach(truncateAll);
  after(truncateAll);

  beforeEach(async function () {
    const callbackPromise = getNextCallback();
    await rangesetRequest(this.frontend, '1.0.0', collection, 'all', {});
    const callbackRoot = await callbackPromise;
    this.callback = `${new url.URL(callbackRoot).pathname}/response`;
  });

  afterEach(async function () {
    if (!this.isCompleted) {
      // Clean up dangling service requests
      await request(this.backend).post(this.callback).query({ status: 'successful' });
    }
  });

  describe('containing asynchronous items', function () {
    describe('temporal validation', function () {
      it('rejects temporal params containing invalid dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,broken' } });
        const error = JSON.parse(response.error.text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links).to.eql([]);
      });

      it('rejects temporal params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z' } });
        const error = JSON.parse(response.error.text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links).to.eql([]);
      });

      it('accepts temporal params containing the correct number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
        expect(response.status).to.equal(200);
      });

      it('saves parsed temporal params to the database', async function () {
        await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links.length).to.equal(1);
        expect(job.links[0].temporal).to.eql({ start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
      });
    });

    describe('bbox validation', function () {
      it('rejects bbox params containing invalid numbers', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,broken,3.3' } });
        const error = JSON.parse(response.error.text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links).to.eql([]);
      });

      it('rejects bbox params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2' } });
        const error = JSON.parse(response.error.text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links).to.eql([]);
      });

      it('accepts bbox params containing the correct number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
        expect(response.status).to.equal(200);
      });

      it('saves parsed bbox params to the database', async function () {
        await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.links.length).to.equal(1);
        expect(job.links[0].bbox).to.eql([0.0, 1.1, 2.2, 3.3]);
      });
    });
  });
});
