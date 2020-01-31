const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookRangesetRequest, rangesetRequest } = require('../helpers/ogc-api-coverages');
const StubService = require('../helpers/stub-service');

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

      it('passes the client parameter to the backend', function () {
        expect(this.service.operation.client).to.equal('harmony-test');
      });

      it('passes the user parameter to the backend', function () {
        expect(this.service.operation.user).to.equal('anonymous');
      });
    });

    describe('and the backend service calls back with an error parameter', function () {
      StubService.hook({ params: { error: 'Something bad happened' } });
      hookRangesetRequest(version, collection, variableName, query);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.equal('Something bad happened');
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

  describe('when the backend service does not respond', function () {
    // Starting up docker image can take more than 2 seconds
    this.timeout(10000);
    StubService.hookDockerImage('alpine:3.10.3');
    hookRangesetRequest(version, collection, variableName, { granuleId });

    it('returns an error to the client', async function () {
      expect(this.res.text).to.equal('Service request failed with an unknown error.');
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
      expect(res.body).to.eql({ errors: ['Coverages were not found for the provided CMR collection: NotAVariable'] });
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
      expect(res.body).to.eql({ errors: ['No matching granules found.'] });
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
      expect(res.body).to.eql({ errors: ['"all" cannot be specified alongside other variables'] });
    });
  });
});
