import { expect } from 'chai';
import { describe, it } from 'mocha';

import hookServersStartStop from './helpers/servers';
import StubService from './helpers/stub-service';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import { hookEdlTokenAuthentication, hookEdlTokenAuthenticationError } from './helpers/stub-edl-token';
import { hookLandingPage } from './helpers/landing-page';

describe('Earthdata login bearer token passing', function () {
  const collection = 'C1233800302-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';
  const authHeader = { Authorization: 'Bearer my-bearer-token' };
  const username = 'joe';
  // StubService.hookEach();
  // StubService.hook({ params: { status: 'successful' } });
  hookServersStartStop({ skipEarthdataLogin: false });
  describe('Calls to authenticated resources', function () {
    describe('When providing a valid token', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdlTokenAuthentication(username);
      hookRangesetRequest(version, collection, variableName, { headers: authHeader });

      it('sets the username correctly', function () {
        expect(this.service.operation.user).to.equal(username);
      });

      it('skips the EDL oauth workflow', function () {
        expect(this.res.statusCode).to.equal(303);
        expect(this.res.headers.location).to.include('/jobs/');
      });
    });
    describe('When providing an invalid token', function () {
      hookEdlTokenAuthenticationError();
      hookRangesetRequest(version, collection, variableName, { headers: authHeader });

      it('Returns a 403 HTTP status code', function () {
        expect(this.res.statusCode).to.equal(403);
      });

      it('Returns an error message indicating the user is not authorized', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.ForbiddenError',
          description: 'Error: You are not authorized to access the requested resource',
        });
      });
    });
  });

  describe('Calls to unauthenticated resources', function () {
    describe('When provided an invalid token', function () {
      hookEdlTokenAuthenticationError();
      hookLandingPage();

      it('returns a description mentioning the OGC coverages api', function () {
        const { description } = JSON.parse(this.res.text);
        expect(description).to.include('/{collectionId}/ogc-api-coverages/1.0.0');
      });

      it('ignores the passed in token and successfully directs to the requested page', function () {
        expect(this.res.statusCode).to.equal(200);
        const { description } = JSON.parse(this.res.text);
        expect(description).to.include('/{collectionId}/ogc-api-coverages/1.0.0');
      });
    });
  });
});
