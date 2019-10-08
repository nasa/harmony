const { describe, it } = require('mocha');
const chai = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { wmsRequest } = require('../helpers/wms');

const { expect } = chai;

describe('WMS Endpoint', function () {
  const collection = 'C1215669046-GES_DISC';

  hookServersStartStop();

  describe('Parameter Validation', function () {
    it('returns an HTTP 400 "Bad Request" error with explanatory message when no request parameter is set', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WMS' });
      expect(res).to.have.status(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "request" must be one of "GetCapabilities", "GetMap"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the request parameter is not an available request', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WMS', request: 'GetFeatureInfo' });
      expect(res).to.have.status(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "request" must be one of "GetCapabilities", "GetMap"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when no service parameter is set', async function () {
      const res = await wmsRequest(this.frontend, collection, { request: 'GetCapabilities' });
      expect(res).to.have.status(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "service" must be "WMS"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the service parameter is not "WMS"', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WCS', request: 'GetCapabilities' });
      expect(res).to.have.status(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "service" must be "WMS"'));
    });
  });
});
