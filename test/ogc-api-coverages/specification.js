const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookLandingPage, describeRelation } = require('../helpers/ogc-api-coverages');

const version = '1.0.0';
const collection = 'C1233800302-EEDTEST';

describe(`OGC API - Coverages navigation and specification ${version}`, function () {
  hookServersStartStop();

  describe('The landing page', function () {
    hookLandingPage(collection, version);

    it('returns an HTTP 200 response and JSON content', function () {
      expect(this.res.status).to.equal(200);
      expect(this.res.headers['content-type']).to.equal('application/json; charset=utf-8');
    });

    describeRelation('service-desc', 'the Open API schema', function () {
      it('returns an HTTP 200 response containing Open API YAML', function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.headers['content-type']).to.equal('text/openapi+yaml; charset=utf-8; version=3.0');
        // (PQ) I can't find a way to validate Open API YAML schemas in tests, but express-openapi
        // is validating it on server startup, so even if we were testing it, we'd fail before here
      });

      it('provides a server root relative to the requested collection', function () {
        expect(this.res.text).to.contain(`default: ${collection}`);
      });

      it('uses the same version of the spec that was used to request the landing page', function () {
        expect(this.res.text).to.contain(`/ogc-api-coverages/${version}`);
      });
    });

    describeRelation('conformance', 'conformance classes', function () {
      it('returns an HTTP 200 response containing JSON conformance classes', function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.headers['content-type']).to.equal('application/json; charset=utf-8');
      });

      it('lists conformance to API common core, API common collections, and API coverages core', function () {
        const conformances = JSON.parse(this.res.text).conformsTo;
        expect(conformances).to.include('http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core');
        expect(conformances).to.include('http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/collections');
        expect(conformances).to.include('http://www.opengis.net/spec/ogcapi-coverages-1/1.0/conf/core');
      });
    });
  });
});
