import { describe, it } from 'mocha';
import { expect } from 'chai';
import { hookServersStartStop } from '../helpers/servers';
import { wmsRequest } from '../helpers/wms';

describe('WMS Endpoint', function () {
  const collection = 'C1233800302-EEDTEST';

  hookServersStartStop();

  describe('Parameter Validation', function () {
    it('returns an HTTP 400 "Bad Request" error with explanatory message when no request parameter is set', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WMS' });
      expect(res.status).to.equal(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "request" must be one of "GetCapabilities", "GetMap"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the request parameter is not an available request', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WMS', request: 'GetFeatureInfo' });
      expect(res.status).to.equal(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "request" must be one of "GetCapabilities", "GetMap"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when no service parameter is set', async function () {
      const res = await wmsRequest(this.frontend, collection, { request: 'GetCapabilities' });
      expect(res.status).to.equal(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "service" must be "WMS"'));
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the service parameter is not "WMS"', async function () {
      const res = await wmsRequest(this.frontend, collection, { service: 'WCS', request: 'GetCapabilities' });
      expect(res.status).to.equal(400);
      expect(res.text).to.equal(JSON.stringify('Query parameter "service" must be "WMS"'));
    });
  });
});
