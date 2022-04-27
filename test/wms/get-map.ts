import { describe, it } from 'mocha';
import { expect } from 'chai';
import isUUID from '../../app/util/uuid';
import hookServersStartStop from '../helpers/servers';
import { hookGetMap, wmsRequest, validGetMapQuery } from '../helpers/wms';
import StubService from '../helpers/stub-service';
import { hookSignS3Object } from '../helpers/object-store';

describe('WMS GetMap', function () {
  const collection = 'C1234088182-EEDTEST';
  const variable = 'V1234088187-EEDTEST';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      ...validGetMapQuery,
      layers: `${collection}/${variable}`,
    };
    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookGetMap(collection, query);

      it('passes the bbox parameter to the backend', function () {
        expect(this.service.operation.boundingRectangle).to.eql([-180, -90, 180, 90]);
      });

      it('passes the source collection and variables to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
        expect(source.variables[0].id).to.equal(variable);

      });

      it('passes the crs parameter to the backend', function () {
        expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
      });

      it('passes the crs parameter to the backend via srs object', function () {
        expect(this.service.operation.srs.proj4).to.equal('+proj=longlat +datum=WGS84 +no_defs');
        expect(this.service.operation.srs.wkt).to.equal('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]');
        expect(this.service.operation.srs.epsg).to.equal('EPSG:4326');
      });

      it('passes the format parameter to the backend', function () {
        expect(this.service.operation.outputFormat).to.equal('image/tiff');
      });

      it('passes the width parameter to the backend', function () {
        expect(this.service.operation.outputWidth).to.equal(128);
      });

      it('passes the height parameter to the backend', function () {
        expect(this.service.operation.outputHeight).to.equal(128);
      });

      it('passes the transparent parameter to the backend', function () {
        expect(this.service.operation.isTransparent).to.equal(true);
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
      hookGetMap(collection, query);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.include('Something bad happened');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });
    });

    describe('and the backend service calls back with a redirect', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookGetMap(collection, query);

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
      hookGetMap(collection, query);

      it('returns an HTTP 303 redirect status code to the provided data', function () {
        expect(this.res.status).to.equal(303);
        expect(this.res.headers.location).to.include(signedPrefix);
      });

      it('propagates the Content-Type header to the client', function () {
        expect(this.res.headers['content-type']).to.equal('text/plain; charset=utf-8');
      });
    });
  });
  describe('can provide an optional granule ID', function () {
    const specificGranuleId = 'G1234088197-EEDTEST';
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: `${collection}/${variable}`,
      crs: 'EPSG:4326',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
      granuleId: specificGranuleId,
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookGetMap(collection, query);

      it('passes the source collection, variables, and granule to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
        expect(source.variables[0].id).to.equal(variable);
      });
    });
  });

  describe('can specify a short name instead of a CMR concept ID', function () {
    const shortName = 'harmony_example';
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: `${collection}/${variable}`,
      crs: 'EPSG:4326',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookGetMap(shortName, query);

      it('successfully passes the source collection and variables to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
        expect(source.variables[0].id).to.equal(variable);
      });
    });
  });

  describe('if no matching granules are found', function () {
    const bogusGranuleId = 'G123-BOGUS';
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: `${collection}/${variable}`,
      crs: 'EPSG:4326',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
      granuleId: bogusGranuleId,
    };

    it('returns an HTTP 400 "Bad Request" error with explanatory message when no request parameter is set', async function () {
      const res = await wmsRequest(this.frontend, collection, query);
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: No matching granules found.',
      });
    });
  });

  describe('when provided an invalid set of parameters', function () {
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: collection,
      crs: 'EPSG:4326',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
      skipPreview: 'true',
      invalidParam: 'yes',
      anotherInvalidParam: 'ok',
    };
    it('returns an informative HTTP 400 "Bad Request" error', async function () {
      const res = await wmsRequest(this.frontend, collection, query);
      expect(res.status).to.equal(400);
      expect(res.text).to.include('Invalid parameter(s): invalidParam and anotherInvalidParam');
      expect(res.text).to.include('Allowed parameters are');
    });
  });

  const unsupportedCollection = 'C1243745256-EEDTEST';
  describe('collection that does not have any supported services', function () {
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: `${unsupportedCollection}`,
      crs: 'EPSG:4326',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
    };

    it('returns an HTTP 404 for a collection with no services defined', async function () {
      const res = await wmsRequest(this.frontend, unsupportedCollection, query);
      expect(res.status).to.equal(404);
      expect(res.text).to.include('There is no service configured to support transformations on the provided collection via WMS.');
    });
  });
});
