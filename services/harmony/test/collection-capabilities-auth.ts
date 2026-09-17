import * as http from 'http';

import { expect } from 'chai';
import { SinonStub, stub } from 'sinon';
import request from 'supertest';

import { auth } from './helpers/auth';
import hookServersStartStop from './helpers/servers';
import { hookEdlTokenAuthentication } from './helpers/stub-edl-token';
import * as cmr from '../app/util/cmr';

describe('Collection capabilities endpoint authentication', function () {
  // A collection that is only otherwise exercised by test/collection-capabilities.ts, and
  // never with the token values used below, so its CMR response cache entries here can't
  // collide with entries created by other test files.
  const collectionId = 'C1234088182-EEDTEST';

  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  let cmrGetBaseStub: SinonStub;
  let cmrPostBaseStub: SinonStub;
  let res;

  /**
   * Adds a `before` hook that stubs the CMR request functions (so the tokens passed to CMR
   * can be inspected), sends the given request, and tears the stubs down afterward.
   *
   * @param sendRequest - Sends the request under test and returns the supertest response
   */
  function hookCapabilitiesRequest(sendRequest: (frontend: http.Server) => request.Test): void {
    before(async function () {
      cmrGetBaseStub = stub(cmr, 'cmrGetBase').callThrough();
      cmrPostBaseStub = stub(cmr, 'cmrPostBase').callThrough();
      res = await sendRequest(this.frontend);
    });
    after(function () {
      cmrGetBaseStub.restore();
      cmrPostBaseStub.restore();
      res = undefined;
    });
  }

  /**
   * @returns every token (the 4th positional argument) that was passed to the stubbed
   * `cmrGetBase` and `cmrPostBase` functions while handling the request
   */
  function tokensSentToCmr(): unknown[] {
    return [...cmrGetBaseStub.getCalls(), ...cmrPostBaseStub.getCalls()].map((call) => call.args[3]);
  }

  describe('when no authentication information is provided', function () {
    hookCapabilitiesRequest((frontend) => request(frontend).get('/capabilities').query({ collectionId }));

    it('does not redirect to the Earthdata Login OAuth workflow', function () {
      expect(res.status).to.equal(200);
    });

    it('queries CMR without a token so only publicly available metadata is returned', function () {
      const tokens = tokensSentToCmr();
      expect(tokens.length).to.be.greaterThan(0);
      expect(tokens.every((token) => !token)).to.equal(true);
    });
  });

  describe('when a token is present via an existing Earthdata Login session', function () {
    hookCapabilitiesRequest((frontend) => request(frontend)
      .get('/capabilities')
      .query({ collectionId })
      .use(auth({ username: 'joe' })));

    it('does not redirect to the Earthdata Login OAuth workflow', function () {
      expect(res.status).to.equal(200);
    });

    it('supplies the session token to the CMR query', function () {
      const tokens = tokensSentToCmr();
      expect(tokens.length).to.be.greaterThan(0);
      expect(tokens.every((token) => token === 'fake_access')).to.equal(true);
    });
  });

  describe('when a token is explicitly passed via an Authorization: Bearer header', function () {
    hookEdlTokenAuthentication('joe');
    hookCapabilitiesRequest((frontend) => request(frontend)
      .get('/capabilities')
      .query({ collectionId })
      .set('Authorization', 'Bearer my-bearer-token'));

    it('does not redirect to the Earthdata Login OAuth workflow', function () {
      expect(res.status).to.equal(200);
    });

    it('supplies the bearer token to the CMR query', function () {
      const tokens = tokensSentToCmr();
      expect(tokens.length).to.be.greaterThan(0);
      expect(tokens.every((token) => token === 'my-bearer-token')).to.equal(true);
    });
  });
});
