const { expect } = require('chai');
const { describe, it, beforeEach } = require('mocha');
const request = require('supertest');
const { hookServersStartStop } = require('./helpers/servers');

const fakeUsername = 'testy_mctestface';
describe('Earthdata Login', function () {
  const collection = 'C1215669046-GES_DISC';
  const authedUrl = `/${collection}/wms?service=WMS&request=GetCapabilities`;
  const unauthedUrl = '/';

  hookServersStartStop();

  describe('Calls to authenticated resources', function () {
    describe('When a request provides no token', function () {
      beforeEach(async function () {
        this.res = await request(this.frontend).get(authedUrl).redirects(0);
      });

      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(307);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });

      it('does not call the application request handler', function () {
        expect(this.res.body).to.be.empty;
      });
    });

    describe('When a request provides a valid token', function () {
      let res;
      beforeEach(async function () {
        res = await client.GET('/', { auth: true });
      });

      it('calls the application request handler', function () {
        expect(res.statusCode).to.be(200);
      });

      it('provides the Earthdata Login user name to the application request handler', function () {
        expect(res.body).to.be(`Hello, ${fakeUsername}`);
      });
    });

    describe('When a request provides an invalid token', function () {
      let res;
      beforeEach(async function () {
        res = await client.GET('/', { auth: true, secret: 'BadSecret' });
      });

      it('returns an authentication error', function () {
        expect(res.statusCode).to.be(403);
      });

      it('clears the invalid token', function () {
        expect(res.headers['set-cookie'][0]).to.contain('auth=;');
      });

      it('does not call the application request handler', function () {
        expect(res.body).to.be('Forbidden');
      });
    });

    describe('When a request provides an expired token', function () {
      describe('and the library successfully refreshes the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/', { auth: true, expired: true });
        });

        it('supplies a the new token to the client', function () {
          expect(client.readAuthCookie(res).token.refreshed).to.be(true);
        });

        it('calls the application request handler', function () {
          expect(res.statusCode).to.be(200);
        });

        it('provides the Earthdata Login user name to the application request handler', function () {
          expect(res.body).to.be(`Hello, ${fakeUsername}`);
        });
      });

      describe('and the request fails to refresh the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/', { auth: true, expired: true, failRefresh: true });
        });

        it('returns a server error', function () {
          expect(res.statusCode).to.be(403);
        });

        it('clears the failing token', function () {
          expect(res.headers['set-cookie'][0]).to.contain('auth=;');
        });

        it('does not call the application request handler', function () {
          expect(res.body).to.be('Forbidden');
        });
      });
    });
  });

  describe('Callbacks from Earthdata Login', function () {
    describe('When Earthdata login validates the provided code', function () {
      describe('and a redirect location has been captured in the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/callback?code=abc123', { location: '/tohere' });
        });

        it('redirects to the supplied redirect location', function () {
          expect(res.statusCode).to.be(307);
          expect(res.headers.location).to.be('/tohere');
        });

        it('provides the token to the client', function () {
          expect(client.readAuthCookie(res).token.succeeded).to.be(true);
        });
      });

      describe('and no redirect location is present in the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/callback?code=abc123');
        });

        it('redirects to the server root', function () {
          expect(res.statusCode).to.be(307);
          expect(res.headers.location).to.be('/');
        });

        it('provides the token to the client', function () {
          expect(client.readAuthCookie(res).token.succeeded).to.be(true);
        });
      });
    });

    describe('When Earthdata login does not validate the provided code', function () {
      let res;
      beforeEach(async function () {
        res = await client.GET('/callback?code=fail', { failCode: true });
      });

      it('returns an authentication error', function () {
        expect(res.statusCode).to.be(403);
      });
    });
  });

  describe('Logout request', function () {
    describe('When the client supplies a token', function () {
      describe('and a redirect location has been captured in the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/logout?redirect=/tohere', { auth: true });
        });

        it('removes the token', function () {
          expect(res.headers['set-cookie'][0]).to.contain('auth=;');
        });

        it('redirects to the endpoint supplied in the \'redirect\' parameter', function () {
          expect(res.statusCode).to.be(307);
          expect(res.headers.location).to.be('/tohere');
        });
      });

      describe('and no redirect location has been captured in the token', function () {
        let res;
        beforeEach(async function () {
          res = await client.GET('/logout', { auth: true });
        });

        it('removes the token', function () {
          expect(res.headers['set-cookie'][0]).to.contain('auth=;');
        });

        it('redirects to the site root', function () {
          expect(res.statusCode).to.be(307);
          expect(res.headers.location).to.be('/');
        });
      });
    });

    describe('When the client does not supply a token', function () {
      let res;
      beforeEach(async function () {
        res = await client.GET('/logout?redirect=/tohere');
      });

      it('redirects to the endpoint supplied in the \'redirect\' parameter', function () {
        expect(res.statusCode).to.be(307);
        expect(res.headers.location).to.be('/tohere');
      });
    });
  });
});
