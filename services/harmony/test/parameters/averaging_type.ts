// Note that there are currently no time or area averaging services in any services.yml
// which is why several of the assertions are using `xit`. Once there are services to
// support it we should enable the assertions and uncomment out the code to follow
// the redirects.

import { expect } from 'chai';

import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import { hookEdrRequest } from '../helpers/ogc-api-edr';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';
import { partialApply } from '../helpers/util';

// import { hookRedirect } from '../helpers/hooks';

const collection = 'C1233800302-EEDTEST';
const edrVersion = '1.1.0';

// We want to test the average parameter on each of the following APIs, so we'll
// run the same tests against each in a loop
const endpointFunctions = [{
  label: 'OGC Coverages',
  endpointFn: partialApply(hookRangesetRequest, '1.0.0', collection, 'all'),
  extraArgs: {},
}, {
  label: 'EDR area',
  endpointFn: partialApply(hookEdrRequest, 'area', edrVersion, collection),
  extraArgs: { coords: 'POLYGON ((-65.3 -13.2, -29.8 -50.9, 17.9 30.1, -65.3 -13.2))' },
}, {
  label: 'EDR position',
  endpointFn: partialApply(hookEdrRequest, 'position', edrVersion, collection),
  extraArgs: { coords: 'POINT (-40 10)' },
}, {
  label: 'EDR trajectory',
  endpointFn: partialApply(hookEdrRequest, 'trajectory', edrVersion, collection),
  extraArgs: { coords: 'LINESTRING (-40 10, 30 10)' },
}, {
  label: 'EDR cube',
  endpointFn: partialApply(hookEdrRequest, 'cube', edrVersion, collection),
  extraArgs: { bbox: '-20.1,0,20,10' },
}];

for (const { label, endpointFn, extraArgs } of endpointFunctions) {
  describe(`average for ${label} API`, function () {
    hookServersStartStop();

    describe('when making a request with average time', function () {
      const averagingTimeQuery = {
        average: 'time',
      };

      describe('for a collection that can support it', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        endpointFn({ query: { ...averagingTimeQuery, ...extraArgs } });
        // hookRedirect('anonymous');

        xit('returns a 200 status code for the request', async function () {
          expect(this.res.status).to.equal(200);
        });

        xit('specifies to perform time averaging in the operation', async function () {
          expect(this.service.operation.average).to.equal('time');
        });
      });

      describe('for a collection that has no service that can support it', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        endpointFn({ query: { ...averagingTimeQuery, ...extraArgs } });

        it('returns a 422 status code for the request', async function () {
          expect(this.res.status).to.equal(422);
        });

        it('returns a message indicating that no service supports time averaging', async function () {
          const error = this.res.body;
          expect(error.code).to.equal('harmony.UnsupportedOperation');
          expect(error.description).to.include('time averaging');
        });
      });
    });

    describe('when making a request with average area', function () {
      const averagingAreaQuery = {
        average: 'area',
      };

      describe('for a collection that can support it', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        endpointFn({ query: { ...averagingAreaQuery, ...extraArgs } });
        // hookRedirect('anonymous');

        xit('returns a 200 status code for the request', async function () {
          expect(this.res.status).to.equal(200);
        });

        xit('specifies to perform area averaging in the operation', async function () {
          expect(this.service.operation.average).to.equal('area');
        });
      });

      describe('for a collection that has no service that can support it', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        endpointFn({ query: { ...averagingAreaQuery, ...extraArgs } });

        it('returns a 422 status code for the request', async function () {
          expect(this.res.status).to.equal(422);
        });

        it('returns a message indicating that no service supports area averaging', async function () {
          const error = this.res.body;
          expect(error.code).to.equal('harmony.UnsupportedOperation');
          expect(error.description).to.include('area averaging');
        });
      });
    });

    describe('when making a request with an invalid average', function () {
      const badAveragingQuery = {
        average: 'no not that',
      };
      endpointFn({ query: { ...badAveragingQuery, ...extraArgs } });

      it('returns a 400 status code for the request', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a message indicating that the average value is invalid', async function () {
        const errorMessage = {
          'code': 'harmony.RequestValidationError',
          'description': 'Error: query parameter "average" must be either "time" or "area"',
        };
        expect(this.res.body).to.eql(errorMessage);
      });
    });
  });
}