import { expect } from 'chai';
import { describe, it } from 'mocha';

import { convertWktToCircles, parseRadius } from '../../app/frontends/ogc-edr/get-data-for-radius';
import env from '../../app/util/env';
import { RequestValidationError } from '../../app/util/errors';
import isUUID from '../../app/util/uuid';
import { itRedirectsToJobStatusUrl } from '../helpers/jobs';
import { hookPostEdrRequest, hookEdrRequest, edrRequest } from '../helpers/ogc-api-edr';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

/**
 * Returns the great circle distance in meters between two [lon, lat] points
 *
 * @param p1 - the first point
 * @param p2 - the second point
 * @returns the distance in meters
 */
function haversineDistance([lon1, lat1]: number[], [lon2, lat2]: number[]): number {
  const toRad = (d: number): number => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

describe('parseRadius', () => {
  it('converts kilometers to meters', () => {
    expect(parseRadius(10, 'km')).to.equal(10000);
  });

  it('converts meters to meters', () => {
    expect(parseRadius('500', 'm')).to.equal(500);
  });

  it('converts miles to meters', () => {
    expect(parseRadius(2, 'mi')).to.equal(3218.688);
  });

  it('converts feet to meters', () => {
    expect(parseRadius(1000, 'ft')).to.be.closeTo(304.8, 1e-9);
  });

  it('treats the units case insensitively', () => {
    expect(parseRadius(10, 'KM')).to.equal(10000);
  });

  it('throws an error when within is missing', () => {
    expect(() => parseRadius(undefined, 'km')).to.throw(RequestValidationError, 'query parameter "within" is required');
  });

  it('throws an error when within is not a number', () => {
    expect(() => parseRadius('abc', 'km')).to.throw(
      RequestValidationError, 'query parameter "within" must be a positive number, but was: abc');
  });

  it('throws an error when within is zero', () => {
    expect(() => parseRadius(0, 'km')).to.throw(
      RequestValidationError, 'query parameter "within" must be a positive number, but was: 0');
  });

  it('throws an error when within is negative', () => {
    expect(() => parseRadius(-1, 'km')).to.throw(
      RequestValidationError, 'query parameter "within" must be a positive number, but was: -1');
  });

  it('throws an error when within-units is missing', () => {
    expect(() => parseRadius(10, undefined)).to.throw(
      RequestValidationError, 'query parameter "within-units" is required');
  });

  it('throws an error when within-units is not supported', () => {
    expect(() => parseRadius(10, 'parsecs')).to.throw(
      RequestValidationError, 'query parameter "within-units" must be one of m, km, mi, ft, but was: parsecs');
  });
});

describe('convertWktToCircles', () => {
  it('converts a POINT to a polygon approximating a circle with the given radius', () => {
    const center = [-40, 10];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoJson: any = convertWktToCircles('POINT (-40 10)', 10000);
    expect(geoJson.features.length).to.equal(1);
    const { geometry } = geoJson.features[0];
    expect(geometry.type).to.equal('Polygon');
    const ring = geometry.coordinates[0];
    expect(ring.length).to.be.greaterThan(4);
    expect(ring[0]).to.eql(ring[ring.length - 1]);
    for (const vertex of ring) {
      expect(haversineDistance(center, vertex)).to.be.closeTo(10000, 10);
    }
  });

  it('converts a MULTIPOINT to a multipolygon with a circle around each point', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoJson: any = convertWktToCircles('MULTIPOINT ((-40 10), (30 -20))', 5000);
    const { geometry } = geoJson.features[0];
    expect(geometry.type).to.equal('MultiPolygon');
    expect(geometry.coordinates.length).to.equal(2);
    for (const [index, center] of [[-40, 10], [30, -20]].entries()) {
      for (const vertex of geometry.coordinates[index][0]) {
        expect(haversineDistance(center, vertex)).to.be.closeTo(5000, 10);
      }
    }
  });

  it('splits a circle that crosses the antimeridian', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoJson: any = convertWktToCircles('POINT (179.99 0)', 50000);
    const { geometry } = geoJson.features[0];
    expect(geometry.type).to.equal('MultiPolygon');
    expect(geometry.coordinates.length).to.equal(2);
    for (const polygon of geometry.coordinates) {
      for (const [lon] of polygon[0]) {
        expect(lon).to.be.within(-180, 180);
      }
    }
  });

  it('does not include the radius in the feature properties', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoJson: any = convertWktToCircles('POINT (-40 10)', 10000);
    expect(geoJson.features[0].properties).to.eql({});
  });

  it('throws an error for a circle containing a pole', () => {
    expect(() => convertWktToCircles('POINT (0 89.9)', 50000)).to.throw(
      RequestValidationError, 'the area within the requested radius of (0 89.9) contains a pole, which is not supported');
  });

  it('throws an error for a MULTIPOINT where one circle contains a pole', () => {
    expect(() => convertWktToCircles('MULTIPOINT ((-40 10), (0 -89.9))', 50000)).to.throw(
      RequestValidationError, 'the area within the requested radius of (0 -89.9) contains a pole, which is not supported');
  });

  it('throws an error for a latitude out of range', () => {
    expect(() => convertWktToCircles('POINT (-40 100)', 1000)).to.throw(
      RequestValidationError, 'query parameter "coords" has invalid coordinates (-40 100): POINT (-40 100)');
  });

  it('throws an error for invalid WKT', () => {
    expect(() => convertWktToCircles('POINT 30 10', 1000)).to.throw(
      RequestValidationError, 'query parameter "coords" Invalid WKT string: POINT 30 10');
  });

  it('throws an error for valid WKT that is not POINT/MULTIPOINT', () => {
    const polygon = 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    expect(() => convertWktToCircles(polygon, 1000)).to.throw(
      RequestValidationError, `query parameter "coords" must be a WKT POINT or MULTIPOINT: ${polygon}`);
  });
});

const pointWKT = 'POINT (-40 10)';

describe('OGC API EDR - getEdrRadius', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleId = 'G1233800343-EEDTEST';
  const variableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.1.0';

  hookServersStartStop();

  const tests = [{
    description: 'with variable name',
    variableParam: variableName,
  }, {
    description: 'with variable concept-id',
    variableParam: variableId,
  }];

  for (const test of tests) {
    describe(test.description, function () {

      describe('when provided a valid set of parameters', function () {
        const query = {
          'parameter-name': test.variableParam,
          granuleId,
          crs: 'EPSG:4326',
          coords: pointWKT,
          within: 10,
          'within-units': 'km',
          datetime: '2020-01-01T00:00:00.000Z/2020-01-02T01:00:00.000Z',
          interpolation: 'near',
          scaleExtent: '0,2500000.3,1500000,3300000',
          scaleSize: '1.1,2',
          height: 500,
          width: 1000,
          f: 'image/png',
          skipPreview: 'true',
        };

        describe('calling the backend service', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('radius', version, collection, { query });

          it('provides a staging location to the backend', function () {
            const location = this.service.operation.stagingLocation;
            expect(location).to.include(env.artifactBucket);
          });

          it('passes the source collection to the backend', function () {
            const source = this.service.operation.sources[0];
            expect(source.collection).to.equal(collection);
          });

          it('passes the source variable to the backend', function () {
            const source = this.service.operation.sources[0];
            expect(source.variables.length).to.equal(1);
            expect(source.variables[0].id).to.equal(variableId);
          });

          it('passes the crs parameter to the backend in Proj4 format', function () {
            expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
          });

          it('passes the synchronous mode parameter to the backend and is set to true', function () {
            expect(this.service.operation.isSynchronous).to.equal(true);
          });

          it('passes the request id parameter to the backend', function () {
            expect(isUUID(this.service.operation.requestId)).to.equal(true);
          });

          it('does not include a point in the service operation', function () {
            expect(this.service.operation.model.subset.point).to.be.undefined;
          });

          it('includes a shape approximating a circle with the requested radius in the service operation', function () {
            const shape = JSON.parse(this.service.operation.model.subset.shape);
            expect(shape).to.eql(convertWktToCircles(pointWKT, 10000));
            const { geometry } = shape.features[0];
            expect(geometry.type).to.equal('Polygon');
            for (const vertex of geometry.coordinates[0]) {
              expect(haversineDistance([-40, 10], vertex)).to.be.closeTo(10000, 10);
            }
          });

          it('passes the temporal range to the backend service', function () {
            const { start, end } = this.service.operation.temporal;
            expect(start).to.equal('2020-01-01T00:00:00.000Z');
            expect(end).to.equal('2020-01-02T01:00:00.000Z');
          });

          it('passes the interpolation parameter to the backend', function () {
            expect(this.service.operation.interpolationMethod).to.equal('near');
          });

          it('passes the scaleExtent parameter to the backend', function () {
            expect(this.service.operation.scaleExtent).to.eql({
              x: { min: 0, max: 1500000 },
              y: { min: 2500000.3, max: 3300000 },
            });
          });

          it('passes the scaleSize parameter to the backend', function () {
            expect(this.service.operation.scaleSize).to.eql({ x: 1.1, y: 2 });
          });

          it('passes the height parameter to the backend', function () {
            expect(this.service.operation.outputHeight).to.equal(500);
          });

          it('passes the width parameter to the backend', function () {
            expect(this.service.operation.outputWidth).to.equal(1000);
          });

          it('passes the format parameter to the backend', function () {
            expect(this.service.operation.outputFormat).to.equal('image/png');
          });
        });

        describe('and the backend service calls back with an error parameter', function () {
          StubService.hook({ params: { error: 'Something bad happened' } });
          hookEdrRequest('radius', version, collection, { query });

          it('propagates the error message into the response', function () {
            expect(this.res.text).to.include('Something bad happened');
          });

          it('responds with an HTTP 400 "Bad Request" status code', function () {
            expect(this.res.status).to.equal(400);
          });
        });

        describe('and the backend service calls back with a redirect', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('radius', version, collection, { query });

          it('redirects the client to the provided URL', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.equal('http://example.com');
          });
        });

        describe('using POST', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostEdrRequest('radius', version, collection, { ...query });

          it('successfully queries CMR and accepts the request', function () {
            expect(this.res.status).to.be.lessThan(400);
          });

          it('includes a shape approximating a circle with the requested radius in the service operation', function () {
            const shape = JSON.parse(this.service.operation.model.subset.shape);
            expect(shape).to.eql(convertWktToCircles(pointWKT, 10000));
          });
        });

        describe('which contains both form and query parameter', function () {
          const queryLocal = { ...query };
          delete queryLocal.datetime;
          const queryParameterString = 'datetime=2020-01-01T00%3A00%3A00Z%2F2020-01-02T01%3A00%3A00Z';
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostEdrRequest(
            'radius',
            version,
            collection,
            queryLocal,
            queryParameterString,
          );

          it('passes the temporal range to the backend service', function () {
            const { start, end } = this.service.operation.temporal;
            expect(start).to.equal('2020-01-01T00:00:00Z');
            expect(end).to.equal('2020-01-02T01:00:00Z');
          });

          it('successfully queries CMR and accepts the request', function () {
            expect(this.res.status).to.be.lessThan(400);
          });
        });

        describe('which has a duplicate key from form and query parameter', function () {
          const queryParameterString = 'datetime=2020-01-01T00%3A00%3A00Z%2F2020-01-02T01%3A00%3A00Z';
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostEdrRequest(
            'radius',
            version,
            collection,
            query,
            queryParameterString,
          );

          it('propagates the error message into the response', function () {
            expect(this.res.text).to.include('Duplicate keys');
          });

          it('responds with an HTTP 400 "Bad Request" status code', function () {
            expect(this.res.status).to.equal(400);
          });
        });
      });
    });
  }

  describe('when provided a MULTIPOINT', function () {
    const multiPointWKT = 'MULTIPOINT ((-40 10), (30 10))';
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('radius', version, collection, {
      query: { coords: multiPointWKT, within: 2, 'within-units': 'mi', granuleId, 'parameter-name': variableName },
    });

    it('accepts the request', function () {
      expect(this.res.status).to.be.lessThan(400);
    });

    it('includes a shape with a circle around each point in the service operation', function () {
      const shape = JSON.parse(this.service.operation.model.subset.shape);
      expect(shape).to.eql(convertWktToCircles(multiPointWKT, 3218.688));
      expect(shape.features[0].geometry.type).to.equal('MultiPolygon');
      expect(shape.features[0].geometry.coordinates.length).to.equal(2);
    });
  });

  describe('when provided an incorrectly named set of parameters', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('radius', version, collection, { query: { coords: pointWKT, within: 10, 'within-units': 'km', granuleId, outputCrz: '', maxResultz: 100, 'parameter-name': variableName } });
    it('rejects the request with an informative error message', function () {
      expect(this.res.status).to.equal(400);
      expect(this.res.text).to.include('Invalid parameter(s): outputCrz and maxResultz');
      expect(this.res.text).to.include('Allowed parameters are');
    });
  });

  describe('When specifying a collection short name instead of a CMR concept ID', function () {
    const shortName = 'harmony_example';
    const query = { 'parameter-name': variableName, coords: pointWKT, within: 10, 'within-units': 'km' };

    StubService.hook({ params: { status: 'successful' } });
    hookEdrRequest('radius', version, shortName, { query });

    it('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    itRedirectsToJobStatusUrl();
  });

  describe('Validation', function () {
    /**
     * Creates an it assertion that the passed in query causes a 400 validation error
     * with the given error message
     *
     * @param queryParams - The query parameters to send to the request
     * @param message - The error message that should be returned
     * @param code - The error code of the message
     */
    function itReturnsAValidationError(
      queryParams: object, message: string, code = 'openapi.ValidationError',
    ): void {
      it(`returns an HTTP 400 "Bad Request" error with explanatory message ${message}`, async function () {
        if (queryParams['parameter-name'] === undefined) {
          queryParams['parameter-name'] = 'all';
        }
        const res = await edrRequest(
          'radius',
          this.frontend,
          version,
          collection,
          { query: queryParams },
        );
        expect(res.status).to.equal(400);
        expect(res.body).to.eql({
          code,
          description: `Error: ${message}`,
        });
      });
    }

    itReturnsAValidationError(
      { granuleId, within: 10, 'within-units': 'km' },
      'query parameter "coords" should have required property \'coords\'',
    );
    itReturnsAValidationError(
      { granuleId, coords: pointWKT, 'within-units': 'km' },
      'query parameter "within" should have required property \'within\'',
    );
    itReturnsAValidationError(
      { granuleId, coords: pointWKT, within: 10 },
      'query parameter "within-units" should have required property \'within-units\'',
    );
    itReturnsAValidationError(
      { granuleId, coords: pointWKT, within: 'abc', 'within-units': 'km' },
      'query parameter "within" should be number',
    );
    itReturnsAValidationError(
      { granuleId, coords: pointWKT, within: 0, 'within-units': 'km' },
      'query parameter "within" must be a positive number, but was: 0',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, coords: pointWKT, within: 10, 'within-units': 'parsecs' },
      'query parameter "within-units" must be one of m, km, mi, ft, but was: parsecs',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, coords: 'LINESTRING (-40 10, 30 10)', within: 10, 'within-units': 'km' },
      'query parameter "coords" must be a WKT POINT or MULTIPOINT: LINESTRING (-40 10, 30 10)',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, coords: 'POINT (0 89.95)', within: 10, 'within-units': 'km' },
      'the area within the requested radius of (0 89.95) contains a pole, which is not supported',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId: 'G123-BOGUS', coords: pointWKT, within: 10, 'within-units': 'km', 'parameter-name': 'red_var' },
      'No matching granules found.',
      'harmony.RequestValidationError',
    );
  });
});
