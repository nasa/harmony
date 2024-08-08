import { expect } from 'chai';
import { describe, it } from 'mocha';
import _ from 'lodash';
import isUUID from '../../app/util/uuid';
import { itRedirectsToJobStatusUrl } from '../helpers/jobs';
import { hookPostEdrRequest, hookEdrRequest, edrRequest } from '../helpers/ogc-api-edr';
import hookServersStartStop from '../helpers/servers';
import StubService, { hookServices } from '../helpers/stub-service';
import { convertWktToPolygon } from '../../app/frontends/ogc-edr/get-data-for-point';
import { ServiceConfig } from '../../app/models/services/base-service';
import { hookRedirect } from '../helpers/hooks';
import { stub } from 'sinon';
import env from '../../app/util/env';
import { hookDatabaseFailure } from '../helpers/db';

describe('convertWktToPolygon', () => {
  const sideLength = 1;

  it('should convert POINT to POLYGON default', () => {
    const wktPoint = 'POINT (30 10)';
    expect(convertWktToPolygon(wktPoint)).to.equal(
      'POLYGON ((29.99995 9.99995, 30.00005 9.99995, 30.00005 10.00005, 29.99995 10.00005, 29.99995 9.99995))');
  });

  it('should convert MULTIPOINT to MULTIPOLYGON default', () => {
    const wktMultipoint = 'MULTIPOINT ((30 10), (40 40), (20 20), (10 30))';
    const expectedMultipolygon = 'MULTIPOLYGON ('
      + '((29.99995 9.99995, 30.00005 9.99995, 30.00005 10.00005, 29.99995 10.00005, 29.99995 9.99995)), '
      + '((39.99995 39.99995, 40.00005 39.99995, 40.00005 40.00005, 39.99995 40.00005, 39.99995 39.99995)), '
      + '((19.99995 19.99995, 20.00005 19.99995, 20.00005 20.00005, 19.99995 20.00005, 19.99995 19.99995)), '
      + '((9.99995 29.99995, 10.00005 29.99995, 10.00005 30.00005, 9.99995 30.00005, 9.99995 29.99995)))';
    expect(convertWktToPolygon(wktMultipoint)).to.equal(expectedMultipolygon);
  });

  it('should convert POINT to POLYGON with specified sideLength', () => {
    const wktPoint = 'POINT (30 10)';
    const expectedPolygon = 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    expect(convertWktToPolygon(wktPoint, sideLength)).to.equal(expectedPolygon);
  });

  it('should convert MULTIPOINT to MULTIPOLYGON with specified sideLength', () => {
    const wktMultipoint = 'MULTIPOINT ((30 10), (40 40), (20 20), (10 30))';
    const expectedMultipolygon = 'MULTIPOLYGON ('
      + '((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5)), '
      + '((39.5 39.5, 40.5 39.5, 40.5 40.5, 39.5 40.5, 39.5 39.5)), '
      + '((19.5 19.5, 20.5 19.5, 20.5 20.5, 19.5 20.5, 19.5 19.5)), '
      + '((9.5 29.5, 10.5 29.5, 10.5 30.5, 9.5 30.5, 9.5 29.5)))';
    expect(convertWktToPolygon(wktMultipoint, sideLength)).to.equal(expectedMultipolygon);
  });

  it('should throw an error for invalid WKT type', () => {
    const invalidWkt = 'INVALID (30 10)';
    const expectedErrMsg = 'query parameter "coords" invalid WKT format: INVALID (30 10)';
    expect(() => convertWktToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });

  it('should throw an error for invalid WKT POINT format', () => {
    const invalidWkt = 'POINT 30 10';
    const expectedErrMsg = 'query parameter "coords" Invalid WKT string: POINT 30 10';
    expect(() => convertWktToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });

  it('should throw an error for valid WKT that is not POINT/MULTIPOINT', () => {
    const invalidWkt = 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    const expectedErrMsg = 'query parameter "coords" invalid WKT format: '
      + 'POLYGON ((29.5 9.5, 30.5 9.5, 30.5 10.5, 29.5 10.5, 29.5 9.5))';
    expect(() => convertWktToPolygon(invalidWkt, sideLength)).to.throw(expectedErrMsg);
  });
});

const pointWKT = 'POINT (-40 10)';

describe('OGC API EDR - getEdrPosition', function () {
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
          coords: pointWKT,
          datetime: '2020-01-01T00:00:00.000Z/2020-01-02T01:00:00.000Z',
          interpolation: 'near',
          // TODO: it might only make sense to include width and height with a scaleExtent
          // and scaleSize by itself
          scaleExtent: '0,2500000.3,1500000,3300000',
          scaleSize: '1.1,2',
          height: 500,
          width: 1000,
          f: 'image/png',
          skipPreview: true,
          // extend: 'lat,lon', TODO: HARMONY-1569 support extend
        };

        describe('calling the backend service', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('position', version, collection, { query });

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
            expect(this.service.operation.model.subset.shape).to.eql('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-40.00005,9.99995],[-39.99995,9.99995],[-39.99995,10.00005],[-40.00005,10.00005],[-40.00005,9.99995]]]},"properties":{}}]}');
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
          hookEdrRequest('position', version, collection, { query });

          it('propagates the error message into the response', function () {
            expect(this.res.text).to.include('Something bad happened');
          });

          it('responds with an HTTP 400 "Bad Request" status code', function () {
            expect(this.res.status).to.equal(400);
          });
        });

        describe('and the backend service calls back with a redirect', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookEdrRequest('position', version, collection, { query });

          it('redirects the client to the provided URL', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.equal('http://example.com');
          });
        });

        describe('and the backend service calls back with a redirect to an S3 location', function () {
          StubService.hook({ params: { redirect: 's3://my-bucket/public/my-object.tif' } });
          hookEdrRequest('position', version, collection, { query });

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
          hookEdrRequest('position', version, collection, { query });

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
            'position',
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
            'position',
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
            'position',
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
    hookEdrRequest('position', version, collection, { query: { coords: pointWKT, granuleId, outputCrz: '', maxResultz: 100, 'parameter-name': variableName } });
    it('rejects the request with an informative error message', function () {
      expect(this.res.status).to.equal(400);
      expect(this.res.text).to.include('Invalid parameter(s): outputCrz and maxResultz');
      expect(this.res.text).to.include('Allowed parameters are');
    });
  });

  describe('when passed a blank crs', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('position', version, collection, { query: { coords: pointWKT, granuleId, crs: '', 'parameter-name': variableName } });
    it('accepts the request, passing an empty CRS to the backend', function () {
      expect(this.res.status).to.be.lessThan(400);
      expect(this.service.operation.crs).to.not.be;
    });
  });

  const multiVariablesTests = [{
    description: 'Subsetting multiple variables with variable names',
    variableParam: 'red_var,green_var',
  }, {
    description: 'Subsetting multiple variables with variable concept ids',
    variableParam: 'V1233801695-EEDTEST,V1233801696-EEDTEST',
  }, {
    description: 'Subsetting multiple variables with mixed variable name and concept ids',
    variableParam: 'red_var,V1233801696-EEDTEST',
  }];

  for (const test of multiVariablesTests) {
    describe(test.description, function () {
      const query = {
        coords: pointWKT,
        granuleId,
        'parameter-name': test.variableParam,
      };
      const variableId1 = 'V1233801695-EEDTEST';
      const variableId2 = 'V1233801696-EEDTEST';

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { query });

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2);
        expect(source.variables[0].id).to.equal(variableId1);
        expect(source.variables[1].id).to.equal(variableId2);
      });
    });
  }

  describe('Subsetting variables with duplicate in mixed name and concept-id', function () {
    const variableId1 = 'V1233801695-EEDTEST';
    const query = {
      coords: pointWKT,
      granuleId,
      'parameter-name': `red_var,${variableId1}`,
    };

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('position', version, collection, { query });

    it('passes a single variable to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length).to.equal(1);
      expect(source.variables[0].id).to.equal(variableId1);
    });
  });

  describe('Not specifying a single granule ID', function () {
    const query = { coords: pointWKT, 'parameter-name': variableName };

    StubService.hook({ params: { status: 'successful' } });
    hookEdrRequest('position', version, collection, { query });

    xit('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    itRedirectsToJobStatusUrl();
  });

  describe('When specifying a collection short name instead of a CMR concept ID', function () {
    const shortName = 'harmony_example';
    const query = { 'parameter-name': variableName, coords: pointWKT };

    StubService.hook({ params: { status: 'successful' } });
    hookEdrRequest('position', version, shortName, { query });

    it('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    itRedirectsToJobStatusUrl();
  });

  describe('when provided a valid temporal range', function () {
    const query = {
      coords: pointWKT,
      'parameter-name': variableName,
      crs: 'EPSG:4326',
      // Time range matches exactly one granule
      datetime: '2020-01-01T00:00:00.000Z/2020-01-01T01:00:00.000Z',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { query });

      it('synchronously makes the request', function () {
        expect(this.service.operation.isSynchronous).to.equal(true);
      });

      it('passes the temporal range to the backend service', function () {
        const { start, end } = this.service.operation.temporal;
        expect(start).to.equal('2020-01-01T00:00:00.000Z');
        expect(end).to.equal('2020-01-01T01:00:00.000Z');
      });
    });
  });

  describe('when passing a forceAsync parameter', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });

    describe('set to "true"', function () {
      const forceAsync = true;

      describe('and making a request would otherwise be synchronous', function () {
        hookEdrRequest('position', version, collection,
          { query: { coords: pointWKT, granuleId, forceAsync, 'parameter-name': variableName } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });
      });

      describe('and making a request would otherwise be asynchronous', function () {
        hookEdrRequest('position', version, collection, { query: { coords: pointWKT, forceAsync, 'parameter-name': variableName } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });
      });
    });

    describe('set to "false"', function () {
      const forceAsync = false;

      describe('and making a request would otherwise be synchronous', function () {
        hookEdrRequest('position', version, collection,
          { query: { coords: pointWKT, granuleId, forceAsync, 'parameter-name': variableName } });

        it('performs the request synchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(true);
        });
      });

      describe('and making a request would otherwise be asynchronous', function () {
        hookEdrRequest('position', version, collection, { query: { coords: pointWKT, forceAsync, 'parameter-name': variableName } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });
      });
    });
  });

  describe('when a granule limit is set on a service and a collection for that service', function () {
    const serviceConfigs: ServiceConfig<unknown>[] = [
      {
        name: 'nexus-service',
        collections: [
          {
            id: collection,
            granule_limit: 5,
          },
        ],
        type: {
          name: 'turbo',
        },
        steps: [{
          image: 'harmonyservices/query-cmr:fake-test',
          is_sequential: true,
        }],
        granule_limit: 4,
        capabilities: {
          subsetting: {
            variable: true,
          },
        },
      }];
    hookServices(serviceConfigs);
    StubService.hook({ params: { redirect: 'http://example.com' } });

    describe('and maxResults is not set for the query', function () {

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 4 granules because the service nexus-service is limited to 4\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(4);
        });
      });
    });

    describe('and maxResults from the query is set to a value greater than the granule limit for the collection', function () {
      const maxResults = 10;

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, maxResults, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 4 granules because the service nexus-service is limited to 4\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(4);
        });
      });
    });

    describe('and maxResults from the query is set to a value less than the granule limit for the collection', function () {
      const maxResults = 2;

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, maxResults, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by maxResults', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults\.$/);
        });

        it('returns up to maxGraunules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(2);
        });
      });
    });

    describe('when the collection granule limit is greater than the CMR hits, but the CMR hits is greater than the system limit', function () {
      before(function () {
        this.glStub = stub(env, 'maxGranuleLimit').get(() => 3);
      });
      after(function () {
        this.glStub.restore();
      });

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, 'parameter-name': variableName } });
      hookRedirect('jdoe1');

      it('returns a warning message about maxResults limiting the number of results', function () {
        const job = JSON.parse(this.res.text);
        expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 3 granules because of system constraints\.$/);
      });

      it('limits the input granules to the system limit', function () {
        const job = JSON.parse(this.res.text);
        expect(job.numInputGranules).to.equal(3);
      });
    });
  });

  describe('when a granule limit is set on a collection', function () {
    const serviceConfigs: ServiceConfig<unknown>[] = [
      {
        name: 'nexus-service',
        collections: [
          {
            id: collection,
            granule_limit: 5,
          },
        ],
        type: {
          name: 'turbo',
        },
        steps: [{
          image: 'harmonyservices/query-cmr:fake-test',
          is_sequential: true,
        }],
        capabilities: {
          subsetting: {
            variable: true,
          },
        },
      }];
    hookServices(serviceConfigs);
    StubService.hook({ params: { redirect: 'http://example.com' } });

    describe('and maxResults is not set for the query', function () {

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 5 granules because collection C1233800302-EEDTEST is limited to 5 for the nexus-service service\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(5);
        });
      });
    });

    describe('and maxResults from the query is set to a value greater than the granule limit for the collection', function () {
      const maxResults = 10;

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, maxResults, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 5 granules because collection C1233800302-EEDTEST is limited to 5 for the nexus-service service\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(5);
        });
      });
    });

    describe('and maxResults from the query is set to a value less than the granule limit for the collection', function () {
      const maxResults = 2;

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, maxResults, 'parameter-name': variableName } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by maxResults', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults\.$/);
        });

        it('returns up to maxGraunules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(2);
        });
      });
    });

    describe('when the collection granule limit is greater than the CMR hits, but the CMR hits is greater than the system limit', function () {
      before(function () {
        this.glStub = stub(env, 'maxGranuleLimit').get(() => 3);
      });
      after(function () {
        this.glStub.restore();
      });

      hookEdrRequest('position', version, collection, { username: 'jdoe1', query: { coords: pointWKT, 'parameter-name': variableName } });
      hookRedirect('jdoe1');

      it('returns a warning message about maxResults limiting the number of results', function () {
        const job = JSON.parse(this.res.text);
        expect(job.message).to.match(/^CMR query identified \d+ granules, but the request has been limited to process only the first 3 granules because of system constraints\.$/);
      });

      it('limits the input granules to the system limit', function () {
        const job = JSON.parse(this.res.text);
        expect(job.numInputGranules).to.equal(3);
      });
    });
  });

  describe('when requesting output formats', function () {
    const tiff = 'image/tiff';
    const png = 'image/png';
    const anyWildcard = '*/*';
    const imageWildcard = 'image/*';
    const wildcardTiff = '*/tiff';
    const zarr = 'application/x-zarr';
    const unsupportedFormat = 'text/plain';

    describe('when providing an accept header for an unsupported format', function () {
      const headers = { accept: unsupportedFormat };
      const query = { coords: pointWKT, granuleId, 'parameter-name': 'all' };
      hookEdrRequest('position', version, collection, { headers, query });
      it('returns a 422 error response', function () {
        expect(this.res.status).to.equal(422);
      });

      it('indicates the format as the reason the request could not be processed', function () {
        const body = JSON.parse(this.res.text);
        expect(body).to.eql({
          code: 'harmony.UnsupportedOperation',
          description: 'Error: the requested combination of operations: reformatting to text/plain on C1233800302-EEDTEST is unsupported',
        });
      });
    });

    describe('when providing an accept header and a format parameter', function () {
      const pngQuery = { coords: pointWKT, granuleId, 'parameter-name': variableName, f: png };
      const headers = { accept: tiff };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { query: pngQuery, headers });
      it('gives the format parameter precedence over the accept header', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
    });

    describe('when providing */* for the accept header', function () {
      const headers = { accept: anyWildcard };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('chooses the first output format supported by the service (see services.yml)', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing */tiff for the accept header', function () {
      const headers = { accept: imageWildcard };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('selects the first valid tiff format supported', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing image/* for the accept header', function () {
      const headers = { accept: wildcardTiff };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('selects the first valid image format supported', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing an accept header with a parameter', function () {
      const headers = { accept: `${zarr};q=0.9` };
      const query = { coords: pointWKT, granuleId, 'parameter-name': 'all' };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('correctly parses the format from the header', function () {
        expect(this.service.operation.outputFormat).to.equal(zarr);
      });
    });

    describe('when providing multiple formats supported by different services', function () {
      const headers = { accept: `${zarr}, ${tiff}` };
      describe('when requesting variable subsetting which is only supported by one of the services', function () {
        const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookEdrRequest('position', version, collection, { headers, query });
        it('uses the backend service that supports variable subsetting', function () {
          expect(this.service.config.name).to.equal('harmony/service-example');
        });
        it('chooses the tiff format since zarr is not supported by the variable subsetting service', function () {
          expect(this.service.operation.outputFormat).to.equal(tiff);
        });
      });

      describe('when not requesting variable subsetting so either service could be used', function () {
        const query = { coords: pointWKT, granuleId, 'parameter-name': 'all' };
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookEdrRequest('position', version, collection, { headers, query });
        it('uses the first format in the list', function () {
          expect(this.service.operation.outputFormat).to.equal(zarr);
        });
        it('uses the backend service that supports that output format', function () {
          expect(this.service.config.name).to.equal('harmony/netcdf-to-zarr');
        });
      });
    });

    describe('when providing multiple formats with the highest priority being unsupported', function () {
      const headers = { accept: `${unsupportedFormat};q=1.0, ${zarr};q=0.5, ${tiff};q=0.8, ${png};q=0.85` };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('uses the highest quality value format that is supported', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
      it('uses the correct backend service', function () {
        expect(this.service.config.name).to.equal('harmony/service-example');
      });
    });

    describe('when providing multiple formats and not specifying a quality value for one of them', function () {
      const headers = { accept: `${zarr};q=0.5, ${tiff};q=0.8, ${png}` };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('treats the unspecified quality value as 1.0', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
    });

    describe('when requesting an unsupported format followed by */*', function () {
      const headers = { accept: `${unsupportedFormat}, ${anyWildcard}` };
      const query = { coords: pointWKT, granuleId, 'parameter-name': variableName };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookEdrRequest('position', version, collection, { headers, query });
      it('returns a redirect 303 (and not a 404 error)', function () {
        expect(this.res.status).to.equal(303);
      });

      it('chooses the first output format supported by the service (see services.yml)', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });
  });

  describe('when the database catches fire during an asynchronous request', function () {
    const query = { coords: pointWKT, 'parameter-name': variableName };
    hookDatabaseFailure();
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookEdrRequest('position', version, collection, { query });

    it('returns an HTTP 500 error with the JSON error format', function () {
      expect(this.res.status).to.eql(500);
      const body = JSON.parse(this.res.text);
      expect(body).to.eql({
        code: 'harmony.ServerError',
        description: 'Error: Failed to save job to database.',
      });
    });
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
          'position',
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
      { granuleId: 'G123-BOGUS', coords: pointWKT, 'parameter-name': 'red_var' },
      'No matching granules found.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId: '', coords: pointWKT },
      'query parameter "granuleId[0]" should NOT be shorter than 1 characters',
    );
    itReturnsAValidationError(
      { granuleId, crs: 'EPSG:1', coords: pointWKT },
      'query parameter "crs/outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,250,330', coords: pointWKT },
      'query parameter "scaleExtent" should NOT have more than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100', coords: pointWKT },
      'query parameter "scaleExtent" should NOT have fewer than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,nonsense', coords: pointWKT },
      'query parameter "scaleExtent[3]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5', coords: pointWKT },
      'query parameter "scaleSize" should NOT have fewer than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,3,35', coords: pointWKT },
      'query parameter "scaleSize" should NOT have more than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,nonsense', coords: pointWKT },
      'query parameter "scaleSize[1]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '-1.3,55.3', coords: pointWKT },
      'query parameter "scaleSize[0]" should be >= 0',
    );
    itReturnsAValidationError({ granuleId, width: 0, coords: pointWKT }, 'query parameter "width" should be >= 1');
    itReturnsAValidationError({ granuleId, height: 0, coords: pointWKT }, 'query parameter "height" should be >= 1');
    // See util-parameter-parsing.js spec for full details on spatial and temporal subset validation
    itReturnsAValidationError(
      { granuleId, subset: 'lat(nonsense:20)', coords: pointWKT },
      'query parameter "subset" subset dimension "lat" has an invalid numeric value "nonsense"',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, subset: 'time("nonsense":"2010-01-01T01:00:00Z")', coords: pointWKT },
      'query parameter "subset" subset dimension "time" has an invalid date time "nonsense"',
      'harmony.RequestValidationError',
    );

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the variable does not exist', async function () {
      const res = await edrRequest(
        'position',
        this.frontend,
        version,
        collection,
        { query: { coords: pointWKT, granuleId, 'parameter-name': 'NotAVariable' } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Coverages were not found for the provided variables: NotAVariable',
      });
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when "all" is specified with another variable', async function () {
      const res = await edrRequest(
        'position',
        this.frontend,
        version,
        collection,
        { query: { coords: pointWKT, granuleId, 'parameter-name': `all,${variableName}` } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: "all" cannot be specified alongside other variables',
      });
    });

    // no subsetting other than shapefile (implied by 'position'), so we must fail since no service supports shapefile
    // subsetting for this collection
    it('returns an HTTP 422 "Unprocessable Content" error with explanatory message when only shapefile subsetting is specified for a collection that does not support it', async function () {
      const res = await edrRequest(
        'position',
        this.frontend,
        version,
        collection,
        { query: { coords: pointWKT, granuleId } },
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
    const query = { coords: pointWKT, 'parameter-name': 'sea_surface_temperature' };
    StubService.hook({ params: { redirect: 'http://example.com' } });

    hookEdrRequest('position', version, collectionId, { query });

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

describe('OGC API EDR - getEdrPosition with the extend query parameter', async function () {
  hookServersStartStop();
  hookEdrRequest(
    'position',
    '1.1.0',
    'C1233800302-EEDTEST',
    { query: { coords: pointWKT, 'parameter-name': 'all', extend: 'dimension_var', skipPreview: 'true', maxResults: 2 }, username: 'joe' });

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

  // TODO - HARMONY-1569 add tests after we have added a service that supports extend
  // describe('when requesting all vars and extending dimension_var', function () {
  //   StubService.hook({ params: { redirect: 'http://example.com' } });
  //   hookEdrRequest('1.1.0', 'C1233800302-EEDTEST', 'all', { query: { extend: 'dimension_var', skipPreview: 'true', maxResults: 2 }, username: 'joe' });
  //   itRedirectsToJobStatusUrl();
  // });

  // describe('when requesting red_var and extending lat,lon', function () {
  //   StubService.hook({ params: { redirect: 'http://example.com' } });
  //   hookEdrRequest('1.1.0', 'C1233800302-EEDTEST', 'red_var', { query: { extend: 'lat,lon' }, username: 'joe' });
  //   itRedirectsToJobStatusUrl();
  // });
});

describe('OGC API EDR - getEdrPosition with a collection not configured for services', function () {
  const collection = 'C1243745256-EEDTEST';
  const version = '1.1.0';

  hookServersStartStop();

  describe('when requesting an area subset', function () {
    const query = { coords: pointWKT, 'parameter-name': 'all' };
    hookEdrRequest('position', version, collection, { username: 'joe', query });

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
