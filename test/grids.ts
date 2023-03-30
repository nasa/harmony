
import { describe, it } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from './helpers/servers';
import StubService from './helpers/stub-service';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';

const query = {
  maxResults: 1,
  grid: 'LambertDurbin',
};

const collection = 'C1233860183-EEDTEST';

describe('testing grids', function () {
  StubService.hook({ params: { redirect: 'http://example.com' } });
  hookServersStartStop();

  describe('when setting a grid on an OGC coverages rangeset request', function () {
    describe('when the grid exists in CMR', function () {
      hookRangesetRequest('1.0.0', collection, 'all', { query });

      it('translates the UMM grid CRS and passes the outputCrs parameter to the backend', function () {
        expect(this.service.operation.crs).to.equal('+proj=lcc +lat_0=30 +lon_0=10 +lat_1=43 +lat_2=62 +x_0=0 +y_0=0 +ellps=intl +units=m +no_defs');
      });

      it('translates the UMM grid DimensionScale and passes the scaleExtent parameter to the backend', function () {
        expect(this.service.operation.scaleExtent).to.eql({
          x: { min: 1, max: 8000000 },
          y: { min: 1000000, max: 8000000 },
        });
      });

      it('translates the UMM grid DimensionSize and passes the scaleSize parameter to the backend', function () {
        expect(this.service.operation.scaleSize).to.eql({ x: 20, y: 30 });
      });

      it('translates the UMM grid DimensionSize and passes the scaleSize parameter to the backend', function () {
        expect(this.service.operation.outputHeight).to.eql(4000);
      });

      it('translates the UMM grid DimensionSize and passes the scaleSize parameter to the backend', function () {
        expect(this.service.operation.outputWidth).to.eql(6000);
      });

      it('returns a redirect to the job status page', function () {
        expect(this.res.status).to.equal(303);
      });
    });
  });

  describe('when passing a grid that does not exist in CMR', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { grid: 'NoSuchGrid' } });
    it('returns a 400 error to the user', function () {
      expect(this.res.status).to.equal(400);
    });

    it('returns a message indicating that the grid could not be found in CMR', function () {
      expect(JSON.parse(this.res.text)).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Unknown grid NoSuchGrid',
      });
    });
  });

  const invalidCombinationParams = ['scaleExtent', 'scaleSize', 'outputCrs', 'width', 'height'];
  for (const param of invalidCombinationParams) {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { [param]: 1, ...query } });
    describe(`when passing ${param} along with grid`, function () {
      it('returns a 400 error to the user', function () {
        expect(this.res.status).to.equal(400);
      });
      it(`returns a message indicating that ${param} cannot be included with the grid parameter`, function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: When including a grid query parameter, the following parameters may not be provided: scaleExtent, scaleSize, outputCrs, height, and width.',
        });
      });
    });
  }
});