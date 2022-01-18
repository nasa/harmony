import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { stub, SinonStub } from 'sinon';
import { HTTPError } from 'superagent';
import { Job, JobStatus } from '../app/models/job';
import JobLink from '../app/models/job-link';
import { truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import db from '../app/util/db';
import { hookJobCreationEach } from './helpers/jobs';
import { getObjectText } from './helpers/object-store';
import { objectStoreForProtocol, S3ObjectStore } from '../app/util/object-store';
import { hookCallbackEach, hookHttpBackendEach, loadJobForCallback } from './helpers/callbacks';

describe('Backend Callbacks', function () {
  this.timeout(30000);
  const collection = 'C1104-PVC_TS2';
  const href = 'https://example.com/foo';

  hookServersStartStop();

  beforeEach(function () {
    // Avoid signing objects, which mock-aws-s3 cannot do the way we need it to
    stub(S3ObjectStore.prototype, 'signGetObject')
      .callsFake(async (s3Uri) => `signed+${s3Uri}`);
  });

  afterEach(function () {
    (S3ObjectStore.prototype.signGetObject as SinonStub).restore();
  });

  beforeEach(truncateAll);
  after(truncateAll);

  describe('for synchronous requests with asynchronous-style backend responses', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection, turbo: false }).ok(() => true);
    });

    describe('when the service does not provide any results', function () {
      hookCallbackEach((r) => r.query({ status: 'successful', argo: 'true' }), true);

      it('sends a synchronous failure explaining that there were no results', async function () {
        expect(this.userResp.statusCode).to.equal(500);
        expect(this.userResp.text).to.include('The backend service provided 0 outputs when 1 was required');
      });
    });

    describe('when the service provides exactly one result', function () {
      hookCallbackEach((r) => r.query({ item: { href: 'https://example.com/1' } }));
      hookCallbackEach((r) => r.query({ status: 'successful', argo: 'true' }), true);

      it('redirects to the result', function () {
        expect(this.userResp.statusCode).to.eql(303);
        expect(this.userResp.headers.location).to.eql('https://example.com/1');
      });
    });

    describe('when the service provides multiple results', function () {
      hookCallbackEach((r) => r.query({ item: { href: 'https://example.com/1' } }));
      hookCallbackEach((r) => r.query({ item: { href: 'https://example.com/2' } }));
      hookCallbackEach((r) => r.query({ status: 'successful', argo: 'true' }), true);

      it('sends a synchronous failure explaining that there were too many results', function () {
        expect(this.userResp.statusCode).to.equal(500);
        expect(this.userResp.text).to.include('The backend service provided 2 outputs when 1 was required');
      });
    });

    describe('when the service sends an error', function () {
      hookCallbackEach((r) => r.query({ error: 'backend error message' }), true);

      it('sends a synchronous failure containing the error message', function () {
        expect(this.userResp.statusCode).to.equal(400);
        expect(this.userResp.text).to.include('backend error message');
      });
    });
  });

  describe('for jobs created externally from the server', function () {
    hookJobCreationEach();

    beforeEach(async function () {
      this.res = await request(this.backend).post(`/service/${this.job.requestId}/response`).query({ status: 'successful', httpBackend: 'true' });
    });

    it('accepts the callback', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('updates the corresponding job record', async function () {
      const { job } = await Job.byRequestId(db, this.job.requestId);
      expect(job.status).to.equal(JobStatus.SUCCESSFUL);
    });
  });

  describe('for synchronous jobs that complete on another host', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection, turbo: false }).ok(() => true);
    });

    describe('when the backend receives an error on another host', function () {
      beforeEach(async function () {
        const job = await loadJobForCallback(this.callback);
        job.fail('It failed!');
        await job.save(db);
        this.userResp = await this.userPromise;
      });

      it('propagates the error to the user', function () {
        expect(this.userResp.statusCode).to.eql(400);
        expect(this.userResp.text).to.include('It failed!');
      });
    });

    describe('when the backend receives a success callback on another host', function () {
      beforeEach(async function () {
        const job = await loadJobForCallback(this.callback);
        job.addLink(new JobLink({ href: 'https://example.com/another-host', rel: 'data', jobID: job.jobID }));
        job.succeed('It worked!');
        await job.save(db);
        this.userResp = await this.userPromise;
      });

      it('propagates the success response to the user', function () {
        expect(this.userResp.statusCode).to.eql(303);
        expect(this.userResp.headers.location).to.eql('https://example.com/another-host');
      });
    });
  });

  describe('POST body callbacks', function () {
    hookHttpBackendEach(function () {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs: 'ASYNC', layers: collection, turbo: false }).ok(() => true);
    });

    describe('when the callback contains an error parameter', function () {
      hookCallbackEach((r) => r
        .query({ error: 'It failed!' })
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('ignores the POST body content', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.getRelatedLinks('data')).to.be.empty;
      });

      it('fails the job with the provided message', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.status).to.equal(JobStatus.FAILED);
        expect(job.message).to.equal('It failed!');
      });
    });

    describe('when the callback contains an item[href] parameter', function () {
      hookCallbackEach((r) => r
        .query({ item: { href: 'https://example.com/1', title: 'another-file.nc' } })
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('ignores the POST body content', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.getRelatedLinks('data').length).to.equal(1);
      });

      it('stores the link to the provided item', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.getRelatedLinks('data')[0].href).to.equal('https://example.com/1');
      });
    });

    describe('when the callback does not include a Content-Length header', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Length': '0', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('ignores the POST body content', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.getRelatedLinks('data').length).to.equal(0);
      });
    });

    describe('when a Content-Disposition header containing a file name is provided without an item[title] parameter', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('stages the POST body to a file name provided by the Content-Disposition header', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.href).to.match(/\/some-file.nc$/);
      });
    });

    describe('when an item[title] parameter is provided without a Content-Disposition header', function () {
      hookCallbackEach((r) => r
        .query({ item: { title: 'query-file.nc' } })
        .set({ 'Content-Length': '14' })
        .send('Some data here'));

      it('stages the POST body to a file name provided by the item[title] parameter', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.href).to.match(/\/query-file.nc$/);
      });
    });

    describe('when both an item[title] parameter and a Content-Disposition header containing a file name are provided', function () {
      hookCallbackEach((r) => r
        .query({ item: { title: 'query-file.nc' } })
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('stages the POST body to a file name provided by the Content-Disposition header', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.href).to.match(/\/some-file.nc$/);
      });
    });

    describe('when neither an item[title] parameter nor a Content-Disposition header containing a file name are provided', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Length': '14' })
        .send('Some data here'));

      it('returns an error to the service performing the callback', async function () {
        expect(this.callbackRes.statusCode).to.equal(400);
        expect(JSON.parse(this.callbackRes.text)).to.eql({
          code: 'harmony.RequestValidationError',
          message: 'Services providing output via POST body must send a filename via a "Content-Disposition" header or "item[title]" query parameter',
        });
      });
    });

    describe('when the callback provides an item[type] query parameter without a Content-Type header', function () {
      hookCallbackEach((r) => r
        .query({ item: { type: 'text/plain' } })
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('tags the stored object with the provided content type', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        const type = (await objectStoreForProtocol(link.href).headObject(link.href)).Metadata['Content-Type'];
        expect(type).to.equal('text/plain');
      });

      it('sets the "type" field in the job item to the provided content type', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.type).to.equal('text/plain');
      });
    });

    describe('when the callback provides a Content-Type header without an item[type] query parameter', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Type': 'text/plain', 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('tags the stored item with the provided content type', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        const type = (await objectStoreForProtocol(link.href).headObject(link.href)).Metadata['Content-Type'];
        expect(type).to.equal('text/plain');
      });

      it('sets the "type" field in the job item to the provided content type', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.type).to.equal('text/plain');
      });
    });

    describe('when the callback provides both a Content-Type header and an item[type] parameter', function () {
      hookCallbackEach((r) => r
        .query({ item: { type: 'text/plain' } })
        .set({ 'Content-Type': 'text/fancy', 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('tags the stored object with the content type provided in the header', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        const type = (await objectStoreForProtocol(link.href).headObject(link.href)).Metadata['Content-Type'];
        expect(type).to.equal('text/fancy');
      });

      it('sets the "type" field in the job item to the content type provided in the header', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.type).to.equal('text/fancy');
      });
    });

    describe('when the callback provides neither a Content-Type header nor an item[type] parameter', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'));

      it('does not tag the stored item with a content type', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        const meta = (await objectStoreForProtocol(link.href).headObject(link.href)).Metadata;
        expect(meta).to.be.undefined;
      });

      it('does not set the "type" field in the job item', async function () {
        const job = await loadJobForCallback(this.callback);
        const link = job.getRelatedLinks('data')[0];
        expect(link.type).to.be.undefined;
      });
    });

    describe('when a POST body item is received for a synchronous request', function () {
      hookCallbackEach((r) => r
        .set({ 'Content-Length': '14', 'Content-Disposition': 'attachment; filename="some-file.nc"' })
        .send('Some data here'), true);

      it('sets the corresponding job status to successful', async function () {
        const job = await loadJobForCallback(this.callback);
        expect(job.status).to.equal(JobStatus.SUCCESSFUL);
      });

      it('redirects to the stored response content', async function () {
        const { location } = this.userResp.headers;
        expect(this.userResp.statusCode).to.equal(303);
        expect(location).to.match(/\/some-file.nc$/);
        expect(await getObjectText(location.replace('signed+', ''))).to.equal('Some data here');
      });
    });
  });

  describe('for asynchronous requests', function () {
    hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', { query: { turbo: false } }); });

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

    describe('href validation', function () {
      it('rejects links that do not include an href property', async function () {
        const response = await request(this.backend).post(this.callback).query({ item: { temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' } });
        const error = JSON.parse((response.error as HTTPError).text);
        expect(response.status).to.equal(400);
        expect(error).to.eql({
          code: 'harmony.RequestValidationError',
          message: 'JobLink is invalid: ["Job link must include an href"]',
        });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data')).to.eql([]);
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
        const response = await request(this.backend).post(this.callback).query({
          item: { href, temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' },
        });
        expect(response.status).to.equal(200);
      });

      it('saves parsed temporal params to the database', async function () {
        await request(this.backend).post(this.callback).query({
          item: { href, temporal: '2020-01-01T00:00:00Z,2020-01-02T00:00:00Z' },
        });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data').length).to.equal(1);
        expect(job.getRelatedLinks('data')[0].temporal).to.eql({ start: new Date('2020-01-01T00:00:00.000Z'), end: new Date('2020-01-02T00:00:00.000Z') });
      });
    });

    describe('bbox validation', function () {
      hookHttpBackendEach(function () { return rangesetRequest(this.frontend, '1.0.0', collection, 'all', { query: { turbo: false } }); });

      it('rejects bbox params containing invalid numbers', async function () {
        const response = await request(this.backend).post(this.callback).query({
          item: { href, bbox: '0.0,1.1,broken,3.3' },
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

      it('rejects bbox params containing an incorrect number of dates', async function () {
        const response = await request(this.backend).post(this.callback).query({
          item: { href, bbox: '0.0,1.1,2.2' },
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

      it('accepts bbox params containing the correct number of bounding box coordinates', async function () {
        const response = await request(this.backend).post(this.callback).query({
          item: { href, bbox: '0.0,1.1,2.2,3.3' },
        });
        expect(response.status).to.equal(200);
      });

      it('saves parsed bbox params to the database', async function () {
        await request(this.backend).post(this.callback).query({
          item: { href, bbox: '0.0,1.1,2.2,3.3' },
        });
        const job = (await Job.forUser(db, 'anonymous')).data[0];
        expect(job.getRelatedLinks('data').length).to.equal(1);
        expect(job.getRelatedLinks('data')[0].bbox).to.eql([0.0, 1.1, 2.2, 3.3]);
      });
    });
  });

  describe('for callbacks where a corresponding job cannot be found', function () {
    beforeEach(async function () {
      this.res = await request(this.backend).post('/service/missing-thing/response');
    });

    it('replies with a 404 error to the backend service', function () {
      expect(this.res.statusCode).to.equal(404);
    });
  });
});
