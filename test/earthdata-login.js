const { expect } = require('chai');
const { describe, it, beforeEach, afterEach } = require('mocha');
const request = require('supertest');

const { hookServersStartStop } = require('./helpers/servers');
const { auth, authRedirect, token, stubEdlRequest, stubEdlError, unstubEdlRequest } = require('./helpers/auth');
const { itRespondsWithError } = require('./helpers/errors');
const StubService = require('./helpers/stub-service');
const { wmsRequest } = require('./helpers/wms');

const blankToken = /^token=s%3A\./; // The start of a signed empty token cookie
const nonBlankToken = /^token=s%3A[^.]/; // The start of a signed non-empty token cookie
const blankRedirect = /^redirect=s%3A\./; // The start of a signed empty redirect cookie
const nonBlankRedirect = /^redirect=s%3A[^.]/; // The start of a signed non-empty redirect cookie
const fakeUsername = 'testy_mctestface';

describe('Earthdata Login', function () {
  StubService.hookEach();
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('Calls to authenticated resources', function () {
    describe('When a request provides no token', function () {
      beforeEach(async function () {
        this.res = await wmsRequest(this.frontend).redirects(0);
      });

      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(303);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });

      it('does not call the application request handler', function () {
        expect(this.service).to.equal(undefined);
      });

      it('sets the "redirect" cookie to the originally-requested resource', function () {
        expect(this.res.headers['set-cookie'][0]).to.match(nonBlankRedirect);
        // Sanity check the URL to ensure it's a WMS URL and query parameters are preserved
        expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/wms?'));
        expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('service=WMS'));
      });
    });

    describe('When a request provides a valid token', function () {
      beforeEach(async function () {
        this.res = await wmsRequest(this.frontend).use(auth({ username: fakeUsername }));
      });

      it('calls the application request handler', function () {
        expect(this.res.statusCode).to.equal(303); // Redirect to data
      });

      it('provides the Earthdata Login user name to the application request handler', function () {
        expect(this.service.operation.user).to.equal(fakeUsername);
      });
    });

    describe('When a request provides an invalid token', function () {
      beforeEach(async function () {
        this.res = await wmsRequest(this.frontend).use(auth({ secret: 'BadSecret' }));
      });

      itRespondsWithError(403, 'You are not authorized to access the requested resource');

      it('clears the invalid token', function () {
        expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
      });

      it('does not call the application request handler', function () {
        expect(this.service).to.equal(undefined);
      });
    });

    describe('When a request provides an expired token', function () {
      describe('and the library successfully refreshes the token', function () {
        beforeEach(async function () {
          stubEdlRequest(
            '/oauth/token',
            { grant_type: 'refresh_token', refresh_token: 'fake_refresh' },
            token({ accessToken: 'refreshed' }),
          );
          this.res = await wmsRequest(this.frontend)
            .use(auth({ expired: true, username: fakeUsername }));
        });
        afterEach(function () {
          unstubEdlRequest();
        });

        it('supplies a new token to the client', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(nonBlankToken);
          expect(this.res.headers['set-cookie'][0]).to.include('refreshed');
        });

        it('calls the application request handler', function () {
          expect(this.res.statusCode).to.equal(303);
        });

        it('provides the Earthdata Login user name to the application request handler', function () {
          expect(this.service.operation.user).to.equal(fakeUsername);
        });
      });

      describe('and the request fails to refresh the token', function () {
        beforeEach(async function () {
          stubEdlError(
            '/oauth/token',
            { grant_type: 'refresh_token', refresh_token: 'fake_refresh' },
            'Response Error: Forbidden.',
          );
          this.res = await wmsRequest(this.frontend)
            .use(auth({ expired: true, username: fakeUsername }));
        });
        afterEach(function () {
          unstubEdlRequest();
        });

        it('redirects to Earthdata Login', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
        });

        it('does not call the application request handler', function () {
          expect(this.service).to.equal(undefined);
        });

        it('clears the failing token', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
        });

        it('sets the "redirect" cookie to the originally-requested resource', function () {
          expect(this.res.headers['set-cookie'][1]).to.match(nonBlankRedirect);
          expect(this.res.headers['set-cookie'][1]).to.include(encodeURIComponent('/wms?'));
          expect(this.res.headers['set-cookie'][1]).to.include(encodeURIComponent('service=WMS'));
        });
      });
    });
  });

  describe('Callbacks from Earthdata Login', function () {
    describe('When Earthdata login validates a provided code', function () {
      beforeEach(function () {
        stubEdlRequest(
          '/oauth/token',
          { grant_type: 'authorization_code', code: 'abc123', redirect_uri: 'http://localhost:3000/oauth2/redirect' },
          token({ accessToken: 'validated' }),
        );
      });
      afterEach(function () {
        unstubEdlRequest();
      });

      describe('and a redirect location has been captured in the token', function () {
        beforeEach(async function () {
          this.res = await request(this.frontend)
            .get('/oauth2/redirect')
            .query({ code: 'abc123' })
            .use(authRedirect('/tohere'));
        });

        it('redirects to the supplied redirect location', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/tohere');
        });

        it('provides the token to the client', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(nonBlankToken);
          expect(this.res.headers['set-cookie'][0]).to.include('validated');
        });

        it('clears the redirect cookie', function () {
          expect(this.res.headers['set-cookie'][1]).to.match(blankRedirect);
        });

        describe('and the client uses the supplied token cookie to access a resource', function () {
          beforeEach(async function () {
            this.res2 = await wmsRequest(this.frontend)
              .set('Cookie', this.res.headers['set-cookie'][0])
              .use(auth({ username: fakeUsername }));
          });

          it('calls the application request handler', function () {
            expect(this.res2.statusCode).to.equal(303); // Redirect to data
          });

          it('provides the Earthdata Login user name to the application request handler', function () {
            expect(this.service.operation.user).to.equal(fakeUsername);
          });
        });
      });

      describe('and no redirect location is present in the token', function () {
        beforeEach(async function () {
          this.res = await request(this.frontend)
            .get('/oauth2/redirect')
            .query({ code: 'abc123' });
        });

        it('redirects to the server root', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/');
        });

        it('provides the token to the client', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(nonBlankToken);
          expect(this.res.headers['set-cookie'][0]).to.include('validated');
        });
      });
    });

    describe('When Earthdata login does not validate the provided code', function () {
      beforeEach(async function () {
        stubEdlError(
          '/oauth/token',
          { grant_type: 'refresh_token', refresh_token: 'fake_refresh' },
          'Response Error: Forbidden.',
        );
        this.res = await wmsRequest(this.frontend)
          .use(auth({ expired: true, username: fakeUsername }));
      });
      afterEach(function () {
        unstubEdlRequest();
      });

      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(307);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });

      it('does not call the application request handler', function () {
        expect(this.service).to.equal(undefined);
      });

      it('sets the "redirect" cookie to the originally-requested resource', function () {
        expect(this.res.headers['set-cookie'][1]).to.match(nonBlankRedirect);
        expect(this.res.headers['set-cookie'][1]).to.include(encodeURIComponent('/wms?'));
        expect(this.res.headers['set-cookie'][1]).to.include(encodeURIComponent('service=WMS'));
      });

      it('clears the failing token', function () {
        expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
      });
    });
  });

  describe('Logout request', function () {
    beforeEach(function () {
      this.req = request(this.frontend).get('/oauth2/logout');
    });

    describe('When the client supplies a token', function () {
      describe('and a "redirect" parameter has been set', function () {
        beforeEach(async function () {
          this.res = await this.req.query({ redirect: '/tohere' }).use(auth({ username: fakeUsername }));
        });

        it('removes the token', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
        });

        it('redirects to the endpoint supplied in the "redirect" parameter', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/tohere');
        });
      });

      describe('and no "redirect" parameter has been set', function () {
        beforeEach(async function () {
          this.res = await this.req.use(auth({ username: fakeUsername }));
        });

        it('removes the token', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
        });

        it('redirects to the site root', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/');
        });
      });
    });

    describe('When the client does not supply a token', function () {
      describe('and a "redirect" parameter has been set', function () {
        beforeEach(async function () {
          this.res = await this.req.query({ redirect: '/tohere' });
        });

        it('redirects to the endpoint supplied in the "redirect" parameter', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/tohere');
        });
      });

      describe('and no "redirect" parameter has been set', function () {
        beforeEach(async function () {
          this.res = await this.req;
        });

        it('redirects to the site root', function () {
          expect(this.res.statusCode).to.equal(307);
          expect(this.res.headers.location).to.equal('/');
        });
      });
    });
  });

  describe('Calls to unauthenticated resources', function () {
    describe('When loading the site root', function () {
      beforeEach(function () {
        this.req = request(this.frontend).get('/');
      });

      describe('if the request does not provide a token', function () {
        beforeEach(async function () {
          this.res = await this.req;
        });

        it('allows the request', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('if the request provides a token', function () {
        beforeEach(async function () {
          this.res = await this.req.use(auth({}));
        });

        it('allows the request', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('if the request provides an invalid token', function () {
        beforeEach(async function () {
          this.res = await this.req.use(auth({ secret: 'BadSecret' }));
        });

        it('allows the request @non-requirement', function () {
          expect(this.res.statusCode).to.equal(200);
        });

        it('clears the invalid token @non-requirement', function () {
          expect(this.res.headers['set-cookie'][0]).to.match(blankToken);
        });
      });
    });

    describe('When loading a documentation URL', function () {
      beforeEach(function () {
        this.req = request(this.frontend).get('/docs/eoss');
      });

      describe('if the request does not provide a token', function () {
        beforeEach(async function () {
          this.res = await this.req;
        });

        it('allows the request', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('if the request does not provide a token', function () {
        beforeEach(async function () {
          this.res = await this.req.use(auth({}));
        });

        it('allows the request', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
    });
  });
});
