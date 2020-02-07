const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookRangesetRequest, rangesetRequest } = require('../helpers/ogc-api-coverages');
const StubService = require('../helpers/stub-service');
const isUUID = require('../helpers/uuid');

describe('OGC API Coverages - getCoverageRangeset', function () {
  const collection = 'C1215669046-GES_DISC';
  const granuleId = 'G1224343298-GES_DISC';
  const variableId = 'V1224729877-GES_DISC';
  const variableName = 'CloudFrc_A';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      granuleId,
      outputCrs: 'CRS:84',
      subset: ['lat(0:10)', 'lon(-20.1:20)'],
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, query);

      it('passes the source collection to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
      });

      it('passes the source variable to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length === 1);
        expect(source.variables[0].id).to.equal(variableId);
      });

      it('passes the source granule to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(granuleId);
      });

      it('passes the outputCrs parameter to the backend in Proj4 format', function () {
        expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
      });

      it('passes the client parameter to the backend', function () {
        expect(this.service.operation.client).to.equal('harmony-test');
      });

      it('passes the user parameter to the backend', function () {
        expect(this.service.operation.user).to.equal('anonymous');
      });

      it('passes the synchronous mode parameter to the backend and is set to true', function () {
        expect(this.service.operation.isSynchronous).to.equal(true);
      });

      it('passes the request id parameter to the backend', function () {
        expect(isUUID(this.service.operation.requestId)).to.equal(true);
      });

      it('transforms subset lat and lon parameters into a backend bounding box subset request', function () {
        expect(this.service.operation.boundingRectangle).to.eql([-20.1, 0, 20, 10]);
      });
    });

    describe('and the backend service calls back with an error parameter', function () {
      StubService.hook({ params: { error: 'Something bad happened' } });
      hookRangesetRequest(version, collection, variableName, query);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.include('Something bad happened');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });
    });

    describe('and the backend service calls back with a redirect', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, query);

      it('redirects the client to the provided URL', function () {
        expect(this.res.status).to.equal(302);
        expect(this.res.headers.location).to.equal('http://example.com');
      });
    });

    describe('and the backend service provides POST data', function () {
      StubService.hook({
        body: 'realistic mock data',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      hookRangesetRequest(version, collection, variableName, query);

      it('returns an HTTP 200 "OK" status code', function () {
        expect(this.res.status).to.equal(200);
      });

      it('propagates the Content-Type header to the client', function () {
        expect(this.res.headers['content-type']).to.equal('text/plain; charset=utf-8');
      });
    });
  });

  describe('when passed a blank outputCrs', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableName, { granuleId, outputCrs: '' });
    it('accepts the request, passing an empty CRS to the backend', function () {
      expect(this.res.status).to.be.lessThan(400);
      expect(this.service.operation.crs).to.not.be;
    });
  });

  describe('Subsetting multiple variables', function () {
    const variableNames = 'CloudFrc_A,EmisIR_A';
    const query = {
      granuleId,
    };
    const variableId1 = 'V1224729877-GES_DISC';
    const variableId2 = 'V1224352381-GES_DISC';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableNames, query);

    it('passes multiple variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 2);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
    });
  });

  describe('Subsetting to "all" variables', function () {
    const variableNames = 'all';
    const query = {
      granuleId,
    };

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableNames, query);

    it('passes no variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables).to.not.be;
    });
  });

  describe('Not specifying a single granule ID', function () {
    const query = {};

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableName, query);

    it('is processed asynchronously', function () {
      expect(this.service).to.equal(undefined);
    });

    it('returns a JSON response with a jobID and status', function () {
      const { jobId, status } = JSON.parse(this.res.text);

      expect(isUUID(jobId)).to.equal(true);
      expect(status).to.equal('accepted');
    });

    it('returns a warning that the request is truncating the granules being processed', function () {
      const { warning } = JSON.parse(this.res.text);
      expect(warning).to.equal('CMR query identified 41 granules, but the request has been limited to process only the first 20 granules.');
    });
  });

  describe('when the backend service does not respond', function () {
    // Starting up docker image can take more than 2 seconds
    this.timeout(10000);
    StubService.hookDockerImage('alpine:3.10.3');
    hookRangesetRequest(version, collection, variableName, { granuleId });

    it('returns an error to the client', async function () {
      expect(this.res.text).to.include('Service request failed with an unknown error.');
    });
  });

  describe('Validation', function () {
    it('returns an HTTP 400 "Bad Request" error with explanatory message when the variable does not exist', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        'NotAVariable',
        { granuleId },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Coverages were not found for the provided CMR collection: NotAVariable',
      });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when the granule does not exist', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        variableName,
        { granuleId: 'G123-BOGUS' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: No matching granules found.',
      });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when the provided granule ID is blank', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        variableName,
        { granuleId: '' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'openapi.ValidationError',
        description: 'Error: query parameter "granuleId" should NOT be shorter than 1 characters',
      });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when "all" is specified with another coverage', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        `all,${variableName}`,
        { granuleId },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: "all" cannot be specified alongside other variables',
      });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when an invalid CRS is provided', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        variableName,
        { granuleId, outputCrs: 'EPSG:1' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: query parameter "outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.',
      });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when an invalid subset is provided', async function () {
      // See util-parameter-parsing.js spec for full details on subset validation
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        variableName,
        { granuleId, subset: 'lat(nonsense:20)' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: query parameter "subset" subset dimension "lat" has an invalid numeric value "nonsense"',
      });
    });
  });
});
