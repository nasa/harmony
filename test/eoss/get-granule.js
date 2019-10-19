const { describe, it, xit } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { eossGetGranule, hookEossGetGranule } = require('../helpers/eoss');
const StubService = require('../helpers/stub-service');

describe('EOSS GetGranule', function () {
  const collection = 'C1215669046-GES_DISC';
  const granule = 'G1224343298-GES_DISC';
  const variableId = 'V1224729877-GES_DISC';
  const variableName = 'CloudFrc_A';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      rangeSubset: variableName,
      format: 'image/tiff',
      crs: 'CRS:84',
      // version: '0.1.0',
      bbox: '-180,-90,180,90',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEossGetGranule(collection, granule, query);

      it('passes the bbox parameter to the backend', function () {
        expect(this.service.operation.boundingRectangle).to.eql([-180, -90, 180, 90]);
      });

      it('passes the source collection to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
        expect(source.variables[0].id).to.equal(variableId);
      });

      it('passes the crs parameter to the backend', function () {
        expect(this.service.operation.crs).to.equal('CRS:84');
      });

      it('passes the format parameter to the backend', function () {
        expect(this.service.operation.outputFormat).to.equal('image/tiff');
      });
    });

    describe('and the backend service calls back with an error parameter', function () {
      StubService.hook({ params: { error: 'Something bad happened' } });
      hookEossGetGranule(collection, granule, query);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.equal('Something bad happened');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });
    });

    describe('and the backend service calls back with a redirect', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEossGetGranule(collection, granule, query);

      it('redirects the client to the provided URL', function () {
        expect(this.res.status).to.equal(302);
        expect(this.res.headers.location).to.equal('http://example.com');
      });
    });

    describe('and the backend service provides POST data', function () {
      StubService.hook({
        body: 'realistic mock data',
      });
      hookEossGetGranule(collection, granule, query);

      it('sends the data to the client', function () {
        expect(this.res.text).to.equal('realistic mock data');
      });

      it('returns an HTTP 200 "OK" status code', function () {
        expect(this.res.status).to.equal(200);
      });

      xit('propagates the Content-Type header to the client', function () {
        // TODO: This is currently not working, but it seems to be on the StubService side
        //   failing to send headers, not the service invoker failing to deal with them
        expect(this.res.headers.contentType).to.equal('text/plain');
      });
    });
    describe('Validation', function () {
      it('returns an HTTP 400 "Bad Request" error with explanatory message when the bbox parameter is invalid', async function () {
        const expectedErrorResponse = {
          errors: [{
            path: 'bbox',
            errorCode: 'minItems.openapi.validation',
            location: 'query',
            message: 'should NOT have fewer than 4 items' }] };
        const res = await eossGetGranule(this.frontend, collection, granule, { bbox: [1, 2] });
        expect(res.status).to.equal(400);
        expect(res.body).to.eql(expectedErrorResponse);
      });
    });
  });
});
