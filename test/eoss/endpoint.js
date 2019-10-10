const { describe, it } = require('mocha');
const chai = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { eossLandingPageRequest, eossSpecRequest } = require('../helpers/eoss');

const { expect } = chai;

describe('EOSS static content endpoints', function () {
  hookServersStartStop();

  describe('Landing Page', function () {
    it('returns an HTTP 200 and the landing page content', async function () {
      const res = await eossLandingPageRequest();
      expect(res.status).to.equal(200);
      expect(res.text).to.equal('Landing page');
    });
  });

  describe('OpenAPI spec', function () {
    it('returns an HTTP 200 and the OpenAPI spec for an EOSS request', async function () {
      const res = await eossSpecRequest();
      expect(res.status).to.equal(200);
      expect(res.text).to.equal('spec');
    });
  });
});
