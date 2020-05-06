import { describe, it, xit } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from '../helpers/servers';
import { eossGetGranule, hookEossGetGranule } from '../helpers/eoss';
import StubService from '../helpers/stub-service';
import isUUID from '../../app/util/uuid';

describe('EOSS GetGranule', function () {
  const collection = 'C1233800302-EEDTEST';
  const granule = 'G1233800343-EEDTEST';
  const variableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '0.1.0';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      rangeSubset: variableName,
      format: 'image/tiff',
      crs: 'CRS:84',
      bbox: '-180,-90,180,90',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEossGetGranule(version, collection, granule, query);

      it('passes the bbox parameter to the backend', function () {
        expect(this.service.operation.boundingRectangle).to.eql([-180, -90, 180, 90]);
      });

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
        expect(source.granules[0].id).to.equal(granule);
      });

      it('passes the crs parameter to the backend', function () {
        expect(this.service.operation.crs).to.equal('CRS:84');
      });

      it('passes the format parameter to the backend', function () {
        expect(this.service.operation.outputFormat).to.equal('image/tiff');
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
    });

    describe('and the backend service calls back with an error parameter', function () {
      StubService.hook({ params: { error: 'Something bad happened' } });
      hookEossGetGranule(version, collection, granule, query);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.include('Something bad happened');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });
    });

    describe('and the backend service calls back with a redirect', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEossGetGranule(version, collection, granule, query);

      it('redirects the client to the provided URL', function () {
        expect(this.res.status).to.equal(303);
        expect(this.res.headers.location).to.equal('http://example.com');
      });
    });

    describe('and the backend service provides POST data', function () {
      StubService.hook({
        body: 'realistic mock data',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      hookEossGetGranule(version, collection, granule, query);

      xit('sends the data to the client', function () {
        // TODO: node-replay does not support response streaming, which we want to have for
        //   large data files, so this will not work.  There is no documented way to un-hook
        //   node-replay after it is set up.  Luckily it does fix the issue on forwarding
        //   content-type, so we've traded one problematic test for another
        expect(this.res.text).to.equal('realistic mock data');
      });

      it('returns an HTTP 200 "OK" status code', function () {
        expect(this.res.status).to.equal(200);
      });

      it('propagates the Content-Type header to the client', function () {
        expect(this.res.headers['content-type']).to.equal('text/plain; charset=utf-8');
      });
    });
  });

  describe('Subsetting multiple variables', function () {
    const query = {
      rangeSubset: 'red_var,green_var',
      format: 'image/tiff',
      crs: 'CRS:84',
      bbox: '-180,-90,180,90',
    };
    const variableId1 = 'V1233801695-EEDTEST';
    const variableId2 = 'V1233801696-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEossGetGranule(version, collection, granule, query);

    it('passes multiple variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 2);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
    });
  });

  describe('when the backend service does not respond', function () {
    // Starting up docker image can take more than 2 seconds
    this.timeout(10000);
    StubService.hookDockerImage('alpine:3.10.3');
    hookEossGetGranule(version, collection, granule, {});

    it('returns an error to the client', async function () {
      expect(this.res.text).to.include('Service request failed with an unknown error.');
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
      const res = await eossGetGranule(
        this.frontend,
        version,
        collection,
        granule,
        { bbox: [1, 2] },
      );
      expect(res.body).to.eql(expectedErrorResponse);
      expect(res.status).to.equal(400);
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when the variable does not exist', async function () {
      const res = await eossGetGranule(
        this.frontend,
        version,
        collection,
        granule,
        { rangeSubset: 'NotAVariable' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({ errors: ['Invalid rangeSubset parameter: NotAVariable'] });
    });
    it('returns an HTTP 400 "Bad Request" error with explanatory message when the granule does not exist', async function () {
      const res = await eossGetGranule(
        this.frontend,
        version,
        collection,
        'G123-BOGUS',
        { rangeSubset: 'red_var' },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({ errors: ['No matching granules found.'] });
    });
    it('returns an HTTP 404 "Not Found" error for a collection with no services defined', async function () {
      const unsupportedCollection = 'C446398-ORNL_DAAC';
      const res = await eossGetGranule(
        this.frontend,
        version,
        unsupportedCollection,
        granule,
      );
      expect(res.status).to.equal(404);
      expect(res.text).to.include('There is no service configured to support transformations on the provided collection via EOSS.');
    });
  });
});
