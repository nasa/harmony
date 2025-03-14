import { expect } from 'chai';
import { describe, it } from 'mocha';
import _ from 'lodash';
import isUUID from '../../app/util/uuid';
import { itRedirectsToJobStatusUrl } from '../helpers/jobs';
import { hookPostEdrRequest, hookEdrRequest, edrRequest } from '../helpers/ogc-api-edr';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';
import { convertWktLineToPolygon } from '../../app/frontends/ogc-edr/get-data-for-trajectory';
import { validateWkt } from '../../app/util/parameter-parsing-helpers';
import env from '../../app/util/env';

describe('convertWktLineToPolygon', () => {
  const sideLength = 1;

  it('should convert LINESTRING with two points to POLYGON default', () => {
    const wktLine = 'LINESTRING (30 10, 40 40)';
    const generatedPolygon = convertWktLineToPolygon(wktLine);
    validateWkt(generatedPolygon);
    expect(generatedPolygon).to.equal(
      'POLYGON ((29.9999525658351 10.0000158113883, 39.999952565835095 40.0000158113883, 40.000047434164905 39.9999841886117, 30.0000474341649 9.9999841886117, 29.9999525658351 10.0000158113883))');
  });

  it('should convert LINESTRING with more than two points to POLYGON default', () => {
    const wktLine = 'LINESTRING (-40 10, 30 10, 40 20)';
    const expectedMultipolygon = 'MULTIPOLYGON ('
      + '((-40 10.00005, 30 10.00005, 30 9.99995, -40 9.99995, -40 10.00005)), '
      + '((29.999964644660942 10.00003535533906, 39.99996464466094 20.000035355339058, 40.00003535533906 19.999964644660942, '
      + '30.000035355339058 9.99996464466094, 29.999964644660942 10.00003535533906)))';
    const generatedPolygon = convertWktLineToPolygon(wktLine);
    validateWkt(generatedPolygon);
    expect(generatedPolygon).to.equal(expectedMultipolygon);
  });

  it('should convert MULTILINESTRING to MULTIPOLYGON default', () => {
    const wktMultiLineString = 'MULTILINESTRING ((10 10, 20 20, 10 40), (40 40, 30 30, 40 20, 30 10))';
    const expectedMultipolygon = 'MULTIPOLYGON ('
      + '((9.99996464466094 10.00003535533906, 19.999964644660942 20.000035355339058, 20.000035355339058 19.999964644660942, '
      + '10.00003535533906 9.99996464466094, 9.99996464466094 10.00003535533906)), '
      + '((19.99995527864045 19.999977639320225, 9.99995527864045 39.99997763932023, 10.00004472135955 40.00002236067977, '
      + '20.00004472135955 20.000022360679775, 19.99995527864045 19.999977639320225)), '
      + '((40.00003535533906 39.99996464466094, 30.000035355339058 29.999964644660942, 29.999964644660942 30.000035355339058, '
      + '39.99996464466094 40.00003535533906, 40.00003535533906 39.99996464466094)), '
      + '((30.000035355339058 30.000035355339058, 40.00003535533906 20.000035355339058, 39.99996464466094 19.999964644660942, '
      + '29.999964644660942 29.999964644660942, 30.000035355339058 30.000035355339058)), '
      + '((40.00003535533906 19.999964644660942, 30.000035355339058 9.99996464466094, 29.999964644660942 10.00003535533906, '
      + '39.99996464466094 20.000035355339058, 40.00003535533906 19.999964644660942)))';
    const generatedPolygon = convertWktLineToPolygon(wktMultiLineString);
    validateWkt(generatedPolygon);
    expect(generatedPolygon).to.equal(expectedMultipolygon);
  });

  it('should convert LINESTRING to POLYGON with specified sideLength', () => {
    const wktLine = 'LINESTRING (30 10, 40 40)';
    const expectedPolygon = 'POLYGON ((29.525658350974744 10.158113883008419, 39.525658350974744 40.15811388300842, 40.474341649025256 39.84188611699158, 30.474341649025256 9.841886116991581, 29.525658350974744 10.158113883008419))';
    const generatedPolygon = convertWktLineToPolygon(wktLine, sideLength);
    validateWkt(generatedPolygon);
    expect(generatedPolygon).to.equal(expectedPolygon);
  });

  it('should convert MULTILINESTRING to MULTIPOLYGON with specified sideLength', () => {
    const wktMultiLineString = 'MULTILINESTRING ((10 10, 20 20, 10 40), (40 40, 30 30, 40 20, 30 10))';
    const expectedMultipolygon = 'MULTIPOLYGON ('
      + '((9.646446609406727 10.353553390593273, 19.646446609406727 20.353553390593273, 20.353553390593273 19.646446609406727, '
      + '10.353553390593273 9.646446609406727, 9.646446609406727 10.353553390593273)), '
      + '((19.552786404500043 19.77639320225002, 9.552786404500042 39.77639320225002, 10.447213595499958 40.22360679774998, '
      + '20.447213595499957 20.22360679774998, 19.552786404500043 19.77639320225002)), '
      + '((40.35355339059328 39.64644660940672, 30.353553390593273 29.646446609406727, 29.646446609406727 30.353553390593273, '
      + '39.64644660940672 40.35355339059328, 40.35355339059328 39.64644660940672)), '
      + '((30.353553390593273 30.353553390593273, 40.35355339059328 20.353553390593273, 39.64644660940672 19.646446609406727, '
      + '29.646446609406727 29.646446609406727, 30.353553390593273 30.353553390593273)), '
      + '((40.35355339059328 19.646446609406727, 30.353553390593273 9.646446609406727, 29.646446609406727 10.353553390593273, '
      + '39.64644660940672 20.353553390593273, 40.35355339059328 19.646446609406727)))';
    const generatedPolygon = convertWktLineToPolygon(wktMultiLineString, sideLength);
    validateWkt(generatedPolygon);
    expect(generatedPolygon).to.equal(expectedMultipolygon);
  });

  it('should throw an error for invalid WKT type', () => {
    const invalidWkt = 'INVALID (30 10)';
    const expectedErrMsg = 'query parameter "coords" invalid WKT format: INVALID (30 10)';
    expect(() => convertWktLineToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });

  it('should throw an error for invalid WKT LINESTRING format', () => {
    const invalidWkt = 'LINESTRING 30 10';
    const expectedErrMsg = 'query parameter "coords" Invalid WKT string: LINESTRING 30 10';
    expect(() => convertWktLineToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });

  it('should throw an error for invalid WKT LINESTRING with just one point', () => {
    const invalidWkt = 'LINESTRING (30 10)';
    const expectedErrMsg = 'LineString must contain at least two points';
    expect(() => convertWktLineToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });

  it('should throw an error for valid WKT that is not LINESTRING/MULTILINESTRING', () => {
    const invalidWkt = 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    const expectedErrMsg = 'query parameter "coords" invalid WKT format: '
      + 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    expect(() => convertWktLineToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });
});

const lineWKT = 'LINESTRING (-40 10, 30 10)';

describe('OGC API EDR - getEdrTrajectory', function () {
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
          // TODO: there's no service that can also support dimension subsetting for this collection
          // subset: ['lat(0:10)', 'lon(-20.1:20)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")', 'foo(1.1:10)'],
          coords: lineWKT,
          datetime: '2020-01-01T00:00:00.000Z/2020-01-02T01:00:00.000Z',
          interpolation: 'near',
          // TODO: it might only make sense to include width and height with a scaleExtent
          // and scaleSize by itself
          scaleExtent: '0,2500000.3,1500000,3300000',
          scaleSize: '1.1,2',
          height: 500,
          width: 1000,
          f: 'image/png',
          skipPreview: 'true',
          // extend: 'lat,lon', TODO: HARMONY-1569 support extend
        };

        describe('calling the backend service', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('trajectory', version, collection, { query });

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

          it('has an empty set of coordinate variables for a collection with no coordinate variables', function () {
            const source = this.service.operation.sources[0];
            expect(source.coordinateVariables).to.eql([]);
          });

          it('passes the crs parameter to the backend in Proj4 format', function () {
            expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
          });

          it('passes the client parameter to the backend', function () {
            expect(this.service.operation.client).to.equal('harmony-test');
          });

          it('passes the user parameter to the backend', function () {
            expect(this.service.operation.user).to.equal('anonymous');
          });

          it('passes the synchronous mode parameter to the backend and is set to true', function () {
            expect(this.service.operation.isSynchronous).to.equal(true);
          });

          it('passes the request id parameter to the backend', function () {
            expect(isUUID(this.service.operation.requestId)).to.equal(true);
          });

          it('includes a shapefile in the service operation', function () {
            expect(this.service.operation.model.subset.shape).to.eql('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-40,10.00005],[-40,9.99995],[30,9.99995],[30,10.00005],[-40,10.00005]]]},"properties":{}}]}');
          });

          // TODO: Add dimension subsetting test once collection supports it
          xit('passes the arbitrary dimensions to subset to the backend', function () {
            expect(this.service.operation.dimensions).to.eql([{
              name: 'foo',
              min: 1.1,
              max: 10,
            }]);
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

          // TODO: HARMONY-1569 support extend
          xit('passes the extend parameter to the backend', function () {
            expect(this.service.operation.extendDimensions).to.have.members(['lat', 'lon']);
          });
        });

        describe('and the backend service calls back with an error parameter', function () {
          StubService.hook({ params: { error: 'Something bad happened' } });
          hookEdrRequest('trajectory', version, collection, { query });

          it('propagates the error message into the response', function () {
            expect(this.res.text).to.include('Something bad happened');
          });

          it('responds with an HTTP 400 "Bad Request" status code', function () {
            expect(this.res.status).to.equal(400);
          });
        });

        describe('and the backend service calls back with a redirect', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('trajectory', version, collection, { query });

          it('redirects the client to the provided URL', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.equal('http://example.com');
          });
        });

        describe('and the backend service calls back with a redirect to an S3 location', function () {
          StubService.hook({ params: { redirect: 's3://my-bucket/public/my-object.tif' } });
          hookEdrRequest('trajectory', version, collection, { query });

          it('redirects the client to a presigned url', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.include('https://my-bucket/public/my-object.tif');
            expect(this.res.headers.location).to.include('A-userid=anonymous');
          });
        });

        describe('and the backend service provides POST data', function () {
          StubService.hook({
            body: 'realistic mock data',
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': 'filename="out.txt"',
            },
          });
          hookEdrRequest('trajectory', version, collection, { query });

          it('returns an HTTP 303 redirect status code to the provided data', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.include(env.stagingBucket);
          });

          it('propagates the Content-Type header to the client', function () {
            expect(this.res.headers['content-type']).to.equal('text/plain; charset=utf-8');
          });
        });

        describe('which is very large', function () {
          const largeGranuleList = [];
          for (let i = 0; i < 2000; i++) {
            largeGranuleList.push(query.granuleId);
          }

          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostEdrRequest(
            'trajectory',
            version,
            collection,
            { ...query, granuleId: largeGranuleList.join(',') },
          );

          it('successfully queries CMR and accepts the request', function () {
            expect(this.res.status).to.be.lessThan(400);
          });
        });

        describe('which contains both form and query parameter', function () {
          const queryLocal = { ...query };
          delete queryLocal.datetime;
          const queryParameterString = 'datetime=2020-01-01T00%3A00%3A00Z%2F2020-01-02T01%3A00%3A00Z';
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostEdrRequest(
            'trajectory',
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
            'trajectory',
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

  describe('when provided an incorrectly named set of parameters', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('trajectory', version, collection, { query: { coords: lineWKT, granuleId, outputCrz: '', maxResultz: 100, 'parameter-name': variableName } });
    it('rejects the request with an informative error message', function () {
      expect(this.res.status).to.equal(400);
      expect(this.res.text).to.include('Invalid parameter(s): outputCrz and maxResultz');
      expect(this.res.text).to.include('Allowed parameters are');
    });
  });

  describe('when passed a blank crs', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('trajectory', version, collection, { query: { coords: lineWKT, granuleId, crs: '', 'parameter-name': variableName } });
    it('accepts the request, passing an empty CRS to the backend', function () {
      expect(this.res.status).to.be.lessThan(400);
      expect(this.service.operation.crs).to.not.be;
    });
  });

  describe('When specifying a collection short name instead of a CMR concept ID', function () {
    const shortName = 'harmony_example';
    const query = { 'parameter-name': variableName, coords: lineWKT };

    StubService.hook({ params: { status: 'successful' } });
    hookEdrRequest('trajectory', version, shortName, { query });

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
     * @param variable - The variable to use for the request
     * ("all", or variable name(s) or concept ID(s) comma separated, defaults to the value of variableName)
     */
    function itReturnsAValidationError(
      queryParams: object, message: string, code = 'openapi.ValidationError',
    ): void {
      it(`returns an HTTP 400 "Bad Request" error with explanatory message ${message}`, async function () {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        if (queryParams['parameter-name'] === undefined) {
          // eslint-disable-next-line @typescript-eslint/dot-notation
          queryParams['parameter-name'] = 'all';
        }
        const res = await edrRequest(
          'trajectory',
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
      { granuleId: 'G123-BOGUS', coords: lineWKT, 'parameter-name': 'red_var' },
      'No matching granules found.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId: '', coords: lineWKT },
      'query parameter "granuleId[0]" should NOT be shorter than 1 characters',
    );
    itReturnsAValidationError(
      { granuleId, crs: 'EPSG:1', coords: lineWKT },
      'query parameter "crs/outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,250,330', coords: lineWKT },
      'query parameter "scaleExtent" should NOT have more than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100', coords: lineWKT },
      'query parameter "scaleExtent" should NOT have fewer than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,nonsense', coords: lineWKT },
      'query parameter "scaleExtent[3]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5', coords: lineWKT },
      'query parameter "scaleSize" should NOT have fewer than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,3,35', coords: lineWKT },
      'query parameter "scaleSize" should NOT have more than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,nonsense', coords: lineWKT },
      'query parameter "scaleSize[1]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '-1.3,55.3', coords: lineWKT },
      'query parameter "scaleSize[0]" should be >= 0',
    );
    itReturnsAValidationError({ granuleId, width: 0, coords: lineWKT }, 'query parameter "width" should be >= 1');
    itReturnsAValidationError({ granuleId, height: 0, coords: lineWKT }, 'query parameter "height" should be >= 1');
    // See util-parameter-parsing.js spec for full details on spatial and temporal subset validation
    itReturnsAValidationError(
      { granuleId, subset: 'lat(nonsense:20)', coords: lineWKT },
      'query parameter "subset" subset dimension "lat" has an invalid numeric value "nonsense"',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, subset: 'time("nonsense":"2010-01-01T01:00:00Z")', coords: lineWKT },
      'query parameter "subset" subset dimension "time" has an invalid date time "nonsense"',
      'harmony.RequestValidationError',
    );

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the variable does not exist', async function () {
      const res = await edrRequest(
        'trajectory',
        this.frontend,
        version,
        collection,
        { query: { coords: lineWKT, granuleId, 'parameter-name': 'NotAVariable' } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Coverages were not found for the provided variables: NotAVariable',
      });
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when "all" is specified with another variable', async function () {
      const res = await edrRequest(
        'trajectory',
        this.frontend,
        version,
        collection,
        { query: { coords: lineWKT, granuleId, 'parameter-name': `all,${variableName}` } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: "all" cannot be specified alongside other variables',
      });
    });

    // no subsetting other than shapefile (implied by 'trajectory'), so we must fail since no service supports shapefile
    // subsetting for this collection
    it('returns an HTTP 422 "Unprocessable Content" error with explanatory message when only shapefile subsetting is specified for a collection that does not support it', async function () {
      const res = await edrRequest(
        'trajectory',
        this.frontend,
        version,
        collection,
        { query: { coords: lineWKT, granuleId } },
      );
      expect(res.status).to.equal(422);
      expect(res.body).to.eql({
        code: 'harmony.UnsupportedOperation',
        description: `Error: the requested combination of operations: shapefile subsetting on ${collection} is unsupported`,
      });
    });
  });

  describe('when using a collection with coordinate variables', function () {
    const collectionId = 'C1243747507-EEDTEST';
    const query = { coords: lineWKT, 'parameter-name': 'sea_surface_temperature' };
    StubService.hook({ params: { redirect: 'http://example.com' } });

    hookEdrRequest('trajectory', version, collectionId, { query });

    it('includes coordinate variables', function () {
      const source = this.service.operation.sources[0];
      expect(source.coordinateVariables.length).to.equal(8);
      expect(source.coordinateVariables[0]).to.eql({
        fullPath: 'chlorophyll_a',
        id: 'V1244967897-EEDTEST',
        name: 'chlorophyll_a',
        type: 'COORDINATE',
      });
    });
  });
});

describe('OGC API EDR - getEdrTrajectory with the extend query parameter', async function () {
  hookServersStartStop();
  hookEdrRequest(
    'trajectory',
    '1.1.0',
    'C1233800302-EEDTEST',
    { query: { coords: lineWKT, 'parameter-name': 'all', extend: 'dimension_var', skipPreview: 'true', maxResults: 2 }, username: 'joe' });

  it('returns a 422 error response', function () {
    expect(this.res.status).to.equal(422);
  });

  it('returns an error message indicating the transformation could not be performed', function () {
    const body = JSON.parse(this.res.text);
    expect(body).to.eql({
      code: 'harmony.UnsupportedOperation',
      description: 'Error: the requested combination of operations: extend on C1233800302-EEDTEST is unsupported',
    });
  });
});

describe('OGC API EDR - getEdrTrajectory with a collection not configured for services', function () {
  const collection = 'C1243745256-EEDTEST';
  const version = '1.1.0';

  hookServersStartStop();

  describe('when requesting trajectory subset', function () {
    const query = { coords: lineWKT, 'parameter-name': 'all' };
    hookEdrRequest('trajectory', version, collection, { username: 'joe', query });

    it('returns a 422 error response', function () {
      expect(this.res.status).to.equal(422);
    });

    it('returns an error message indicating the transformation could not be performed', function () {
      const body = JSON.parse(this.res.text);
      expect(body).to.eql({
        code: 'harmony.UnsupportedOperation',
        description: 'Error: the requested combination of operations: shapefile subsetting on C1243745256-EEDTEST is unsupported',
      });
    });

  });
});
