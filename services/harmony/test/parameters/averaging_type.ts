import { expect } from 'chai';
// import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

// Note that there are currently no time or area averaging services in services.yml
// which is why several of the assertions are using `xit`. Once there are services to
// support it we should enable the assertions and uncomment out the code to follow
// the redirects.
describe('averagingType', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when making a request with averagingType time', function () {
    const averagingTimeQuery = {
      averagingType: 'time',
    };

    describe('for a collection that can support it', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...averagingTimeQuery } });
      // hookRedirect('anonymous');

      xit('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      xit('specifies to perform time averaging in the operation', async function () {
        expect(this.service.operation.averagingType).to.equal('time');
      });
    });

    describe('for a collection that has no service that can support it', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...averagingTimeQuery } });

      xit('returns a 400 status code for the request', async function () {
        expect(this.res.status).to.equal(400);
      });

      xit('returns a message indicating that no service supports time averaging', async function () {
        const errorMessage = {
          'code': 'harmony.UnsupportedOperation',
          'description': 'Error: the requested combination of operations: time averaging on C1233800302-EEDTEST is unsupported',
        };
        expect(this.res.body).to.eql(errorMessage);
      });
    });
  });

  describe('when making a request with averagingType area', function () {
    const averagingAreaQuery = {
      averagingType: 'area',
    };

    describe('for a collection that can support it', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...averagingAreaQuery } });
      // hookRedirect('anonymous');

      xit('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      xit('specifies to perform area averaging in the operation', async function () {
        expect(this.service.operation.averagingType).to.equal('area');
      });
    });

    describe('for a collection that has no service that can support it', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query: { ...averagingAreaQuery } });

      it('returns a 422 status code for the request', async function () {
        expect(this.res.status).to.equal(422);
      });

      it('returns a message indicating that no service supports area averaging', async function () {
        const errorMessage = {
          'code': 'harmony.UnsupportedOperation',
          'description': 'Error: the requested combination of operations: area averaging on C1233800302-EEDTEST is unsupported',
        };
        expect(this.res.body).to.eql(errorMessage);
      });
    });
  });
});