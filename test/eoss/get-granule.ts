import { describe, it } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from '../helpers/servers';
import { eossGetGranule, hookEossGetGranule } from '../helpers/eoss';
import StubService from '../helpers/stub-service';
import isUUID from '../../app/util/uuid';
import { hookSignS3Object } from '../helpers/object-store';

describe('EOSS GetGranule', function () {
  const collection = 'C1234088182-EEDTEST';
  const granule = 'G1234088196-EEDTEST';
  const variableId = 'V1234088187-EEDTEST';
  const variableName = 'red_var';
  const version = '0.1.0';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      rangeSubset: variableName,
      format: 'image/tiff',
      crs: 'EPSG:4326',
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

      it('passes the crs parameter to the backend', function () {
        expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
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
      const signedPrefix = hookSignS3Object();
      StubService.hook({
        body: 'realistic mock data',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'filename="out.txt"',
        },
      });
      hookEossGetGranule(version, collection, granule, query);

      it('returns an HTTP 303 redirect status code to the provided data', function () {
        expect(this.res.status).to.equal(303);
        expect(this.res.headers.location).to.include(signedPrefix);
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
      crs: 'EPSG:4326',
      bbox: '-180,-90,180,90',
    };
    const variableId1 = 'V1234088187-EEDTEST';
    const variableId2 = 'V1234088188-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEossGetGranule(version, collection, granule, query);

    it('passes multiple variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 2);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
    });
  });

  describe('can specify a short name instead of a collection concept ID', function () {
    const shortName = 'harmony_example';
    const query = {
      rangeSubset: 'red_var,green_var',
      format: 'image/tiff',
      crs: 'EPSG:4326',
      bbox: '-180,-90,180,90',
    };
    const variableId1 = 'V1234088187-EEDTEST';
    const variableId2 = 'V1234088188-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEossGetGranule(version, shortName, granule, query);

    it('passes multiple variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 2);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
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
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: No matching granules found.',
      });
    });
    it('returns an HTTP 404 "Not Found" error for a collection with no services defined', async function () {
      const unsupportedCollection = 'C446474-ORNL_DAAC';
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
