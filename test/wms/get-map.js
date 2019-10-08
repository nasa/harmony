const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookGetMap } = require('../helpers/wms');
const StubService = require('../helpers/stub-service');

describe('WMS GetMap', function () {
  const collection = 'C1215669046-GES_DISC';
  const variable = 'V1224729877-GES_DISC';


  hookServersStartStop();

  describe('Parameter Validation', function () {
    it('FIXME');
  });

  describe('Parameter Propagation', function () {
    it('FIXME');
  });

  describe('when provided a valid set of parameters', function () {
    const query = {
      service: 'WMS',
      request: 'GetMap',
      layers: `${collection}/${variable}`,
      crs: 'CRS:84',
      format: 'image/tiff',
      styles: '',
      width: 128,
      height: 128,
      version: '1.3.0',
      bbox: '-180,-90,180,90',
      transparent: 'TRUE',
    };

    describe('and the backend service calls back with an error parameter', function () {
      StubService.hook({ params: { error: 'Something bad happened' } });
      hookGetMap(collection, query);

      it('propagates the error message into the response', function () {
      });
      it('responds with an HTTP 400 "Bad Request" status code');
    });

    describe('and the backend service calls back with a redirect', function () {
      it('redirects the client to the provided URL');
    });

    describe('and the backend service provides POST data', function () {
      it('sends the data to the client');
      it('returns an HTTP 200 "OK" status code');
      it('propagates the Content-Type header to the client');
      it('propagates the Content-Length header to the client');
    });
  });
});
