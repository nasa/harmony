import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import url from 'url';
import Job from 'models/job';
import { truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { getNextCallback } from '../example/http-backend';

import db = require('util/db');

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
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('rejects temporal params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('accepts temporal params containing the correct number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
        expect(response.status).to.equal(200);
      });

      it('saves parsed temporal params to the database', async function () {
        await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data').length).to.equal(1);
        expect(job.getRelatedLinks('data')[0].temporal).to.eql({ start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
      });
    });

    describe('bbox validation', function () {
      it('rejects bbox params containing invalid numbers', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,broken,3.3' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('rejects bbox params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2' } });
        const error = JSON.parse((response.error as any).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({ code: 400, message: 'Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North' });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
      });

      it('accepts bbox params containing the correct number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
        expect(response.status).to.equal(200);
      });

      it('saves parsed bbox params to the database', async function () {
        await request(this.backend).post(this.callback).query({ item: { bbox: '0.0,1.1,2.2,3.3' } });
        const job = (await Job.forUser(db, 'anonymous'))[0];
        expect(job.getRelatedLinks('data').length).to.equal(1);
        expect(job.getRelatedLinks('data')[0].bbox).to.eql([0.0, 1.1, 2.2, 3.3]);
      });
    });
  });
});
