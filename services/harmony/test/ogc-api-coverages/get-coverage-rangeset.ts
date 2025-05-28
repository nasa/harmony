import { expect } from 'chai';
import { describe, it } from 'mocha';
import _ from 'lodash';
import { stub } from 'sinon';
import isUUID from '../../app/util/uuid';
import { itRedirectsToJobStatusUrl } from '../helpers/jobs';
import { hookPostRangesetRequest, hookRangesetRequest, rangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import StubService, { hookServices } from '../helpers/stub-service';
import { ServiceConfig } from '../../app/models/services/base-service';
import { hookRedirect } from '../helpers/hooks';
import env from '../../app/util/env';
import { hookDatabaseFailure } from '../helpers/db';

describe('OGC API Coverages - getCoverageRangeset', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleId = 'G1233800352-EEDTEST';
  const variableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';

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
          granuleId,
          outputCrs: 'EPSG:4326',
          // TODO: there's no service that can also support dimension subsetting for this collection
          // subset: ['lat(0:10)', 'lon(-20.1:20)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")', 'foo(1.1:10)'],
          subset: ['lat(0:10)', 'lon(-20.1:20)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
          interpolation: 'near',
          // TODO: it might only make sense to include width and height with a scaleExtent
          // and scaleSize by itself
          scaleExtent: '0,2500000.3,1500000,3300000',
          scaleSize: '1.1,2',
          height: 500,
          width: 1000,
          format: 'image/png',
          skipPreview: 'true',
          // extend: 'lat,lon', TODO: HARMONY-1569 support extend
        };

        describe('calling the backend service', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookRangesetRequest(version, collection, test.variableParam, { query });

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

          it('passes the outputCrs parameter to the backend in Proj4 format', function () {
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

          it('transforms subset lat and lon parameters into a backend bounding box subset request', function () {
            expect(this.service.operation.boundingRectangle).to.eql([-20.1, 0, 20, 10]);
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
          hookRangesetRequest(version, collection, test.variableParam, { query });

          it('propagates the error message into the response', function () {
            expect(this.res.text).to.include('Something bad happened');
          });

          it('responds with an HTTP 400 "Bad Request" status code', function () {
            expect(this.res.status).to.equal(400);
          });
        });

        describe('and the backend service calls back with a redirect', function () {
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookRangesetRequest(version, collection, test.variableParam, { query });

          it('redirects the client to the provided URL', function () {
            expect(this.res.status).to.equal(303);
            expect(this.res.headers.location).to.equal('http://example.com');
          });
        });

        describe('and the backend service calls back with a redirect to an S3 location', function () {
          StubService.hook({ params: { redirect: 's3://my-bucket/public/my-object.tif' } });
          hookRangesetRequest(version, collection, test.variableParam, { query });

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
          hookRangesetRequest(version, collection, test.variableParam, { query });

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
          hookPostRangesetRequest(
            version,
            collection,
            test.variableParam,
            { ...query, granuleId: largeGranuleList.join(',') },
          );

          it('successfully queries CMR and accepts the request', function () {
            expect(this.res.status).to.be.lessThan(400);
          });
        });

        describe('which contains both form and query parameter', function () {
          const queryLocal = { ...query };
          delete queryLocal.subset;
          const queryParameterString = 'subset=time%28%222020-01-02T00%3A00%3A00Z%22%3A%222020-01-02T01%3A00%3A00Z%22%29';
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostRangesetRequest(
            version,
            collection,
            test.variableParam,
            queryLocal,
            queryParameterString,
          );

          it('passes the temporal range to the backend service', function () {
            const { start, end } = this.service.operation.temporal;
            expect(start).to.equal('2020-01-02T00:00:00.000Z');
            expect(end).to.equal('2020-01-02T01:00:00.000Z');
          });

          it('successfully queries CMR and accepts the request', function () {
            expect(this.res.status).to.be.lessThan(400);
          });
        });

        describe('which has a duplicate key from form and query parameter', function () {
          const queryParameterString = 'subset=time%28%222020-01-02T00%3A00%3A00Z%22%3A%222020-01-02T01%3A00%3A00Z%22%29';
          StubService.hook({ params: { redirect: 'http://example.com' } });
          hookPostRangesetRequest(
            version,
            collection,
            test.variableParam,
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
    hookRangesetRequest(version, collection, variableName, { query: { granuleId, outputCrz: '', maxResultz: 100 } });
    it('rejects the request with an informative error message', function () {
      expect(this.res.status).to.equal(400);
      expect(this.res.text).to.include('Invalid parameter(s): outputCrz and maxResultz');
      expect(this.res.text).to.include('Allowed parameters are');
    });
  });

  describe('when passed a blank outputCrs', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableName, { query: { granuleId, outputCrs: '' } });
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
        granuleId,
      };
      const variableId1 = 'V1233801695-EEDTEST';
      const variableId2 = 'V1233801696-EEDTEST';

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, test.variableParam, { query });

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2);
        expect(source.variables[0].id).to.equal(variableId1);
        expect(source.variables[1].id).to.equal(variableId2);
      });
    });
  }

  describe('Subsetting variables with duplicate in mixed name and concept-id', function () {
    const query = {
      granuleId,
    };
    const variableId1 = 'V1233801695-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, `red_var,${variableId1}`, { query });

    it('passes a single variable to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length).to.equal(1);
      expect(source.variables[0].id).to.equal(variableId1);
    });
  });

  describe('Subsetting to "all" variables', function () {
    const variableNames = 'all';
    const query = {
      granuleId,
    };

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableNames, { query });

    it('passes no variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables).to.not.be;
    });
  });

  describe('Using the "parameter_vars" pseudo-variable', function () {
    const pseudoVariableName = 'parameter_vars';
    const variableId1 = 'V1233801695-EEDTEST';
    const variableId2 = 'V1233801696-EEDTEST';

    describe('Passing the variables in the query parameters without using "parameter_vars"', function () {
      const query = {
        granuleId,
        variable: [variableId1],
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableId1, { query });

      it('passes multiple variables to the backend service', function () {
        expect(this.res.status).to.equal(400);
        expect(this.res.body).to.eql({
          'code': 'harmony.RequestValidationError',
          'description': 'Error: Value "parameter_vars" must be used in the url path when variables are passed in the query parameters or request body',
        });
      });

    });

    describe('Passing the "parameter_vars" pseudo-variable without specifying variables as parameters', function () {
      const query = {
        granuleId,
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, pseudoVariableName, { query });

      it('passes multiple variables to the backend service', function () {
        expect(this.res.status).to.equal(400);
        expect(this.res.body).to.eql({
          'code': 'harmony.RequestValidationError',
          'description': 'Error: "parameter_vars" specified, but no variables given',
        });
      });

    });

    describe('Passing the variables in the query parameters', function () {
      const query = {
        granuleId,
        variable: [variableId1, variableId2],
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, pseudoVariableName, { query });

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2);
        expect(source.variables[0].id).to.equal(variableId1);
        expect(source.variables[1].id).to.equal(variableId2);
      });

    });

    describe('Passing the variables in the web form', function () {
      const form = {
        granuleId,
        variable: `${variableId1},${variableId2}`,
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookPostRangesetRequest(version, collection, pseudoVariableName, form);

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2);
        expect(source.variables[0].id).to.equal(variableId1);
        expect(source.variables[1].id).to.equal(variableId2);
      });

    });

    describe('Passing the variables in the query and the web form', function () {
      const form = {
        granuleId,
        variable: [variableId1],
      };

      const queryStr = `variable=${variableId2}`;

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookPostRangesetRequest(version, collection, pseudoVariableName, form, queryStr);

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.include('Duplicate keys');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });

    });

    describe('Passing the variables in the web form using names as well as ids', function () {
      const form = {
        granuleId,
        variable: `red_var,${variableId2}`,
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookPostRangesetRequest(version, collection, pseudoVariableName, form);

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2);
        expect(source.variables[0].id).to.equal(variableId1);
        expect(source.variables[1].id).to.equal(variableId2);
      });

    });

    describe('Passing many variables in the web form', function () {
      const largeCollection = 'C20240409-EEDTEST';
      const largeVarList = [];
      for (let i = 0; i < 2000; i++) {
        largeVarList.push(`V9999${i}-EEDTEST`);
      }

      const form = {
        granuleId,
        variable: largeVarList.join(','),
      };

      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookPostRangesetRequest(version, largeCollection, pseudoVariableName, form);

      it('passes multiple variables to the backend service', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length).to.equal(2000);
      });
    });
  });

  describe('Not specifying a single granule ID', function () {
    const query = {};

    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest(version, collection, variableName, { query });

    it('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    itRedirectsToJobStatusUrl();
  });

  describe('When specifying a collection short name instead of a CMR concept ID', function () {
    const shortName = 'harmony_example';

    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest(version, shortName, variableName, {});

    it('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    itRedirectsToJobStatusUrl();
  });

  describe('when provided a valid temporal range', function () {
    const query = {
      outputCrs: 'EPSG:4326',
      // Time range matches exactly one granule
      subset: ['lat(0:10)', 'lon(-20.1:20)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { query });

      it('synchronously makes the request', function () {
        expect(this.service.operation.isSynchronous).to.equal(true);
      });

      it('passes the temporal range to the backend service', function () {
        const { start, end } = this.service.operation.temporal;
        expect(start).to.equal('2020-01-02T00:00:00.000Z');
        expect(end).to.equal('2020-01-02T01:00:00.000Z');
      });
    });
  });

  describe('when passing a forceAsync parameter', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });

    describe('set to "true"', function () {
      const forceAsync = 'true';
      const expectedExtraArgs = { granValidation: { reason: 3,
        hasGranuleLimit: undefined,
        serviceName: 'harmony/service-example',
        shapeType: undefined,
        maxResults: 2100 } };

      describe('and making a request would otherwise be synchronous', function () {
        hookRangesetRequest(version, collection, variableName,
          { query: { granuleId, forceAsync } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });

        it('sets up extraArgs for granule validation', function () {
          expect(this.service.operation.extraArgs).to.eql(expectedExtraArgs);
        });
      });

      describe('and making a request would otherwise be asynchronous', function () {
        hookRangesetRequest(version, collection, variableName, { query: { forceAsync } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });

        it('does not set up extraArgs for granule validation', function () {
          expect(this.service.operation.extraArgs).to.be.undefined;
        });
      });
    });

    describe('set to "false"', function () {
      const forceAsync = 'false';

      describe('and making a request would otherwise be synchronous', function () {
        hookRangesetRequest(version, collection, variableName,
          { query: { granuleId, forceAsync } });

        it('performs the request synchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(true);
        });

        it('does not set up extraArgs for granule validation', function () {
          expect(this.service.operation.extraArgs).to.be.undefined;
        });
      });

      describe('and making a request would otherwise be asynchronous', function () {
        hookRangesetRequest(version, collection, variableName, { query: { forceAsync } });

        it('performs the request asynchronously', function () {
          expect(this.service.operation.isSynchronous).to.equal(false);
        });

        it('does not set up extraArgs for granule validation', function () {
          expect(this.service.operation.extraArgs).to.be.undefined;
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

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: {} });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 4 granules because the service nexus-service is limited to 4\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(4);
        });
      });
    });

    describe('and maxResults from the query is set to a value greater than the granule limit for the collection', function () {
      const maxResults = 10;

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: { maxResults } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 4 granules because the service nexus-service is limited to 4\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(4);
        });
      });
    });

    describe('and maxResults from the query is set to a value less than the granule limit for the collection', function () {
      const maxResults = 2;

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: { maxResults } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by maxResults', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults\.$/);
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

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: {} });
      hookRedirect('jdoe1');

      it('returns a warning message about maxResults limiting the number of results', function () {
        const job = JSON.parse(this.res.text);
        expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 3 granules because of system constraints\.$/);
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

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: {} });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 5 granules because collection C1233800302-EEDTEST is limited to 5 for the nexus-service service\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(5);
        });
      });
    });

    describe('and maxResults from the query is set to a value greater than the granule limit for the collection', function () {
      const maxResults = 10;

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: { maxResults } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by the collection configuration', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 5 granules because collection C1233800302-EEDTEST is limited to 5 for the nexus-service service\.$/);
        });

        it('returns up to the granule limit configured for the collection', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(5);
        });
      });
    });

    describe('and maxResults from the query is set to a value less than the granule limit for the collection', function () {
      const maxResults = 2;

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: { maxResults } });
      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');
        it('returns a human-readable message field indicating the request has been limited to a subset of the granules determined by maxResults', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults\.$/);
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

      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1', query: {} });
      hookRedirect('jdoe1');

      it('returns a warning message about maxResults limiting the number of results', function () {
        const job = JSON.parse(this.res.text);
        expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 3 granules because of system constraints\.$/);
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
    const netcdf = 'application/x-netcdf4';
    const anyWildcard = '*/*';
    const imageWildcard = 'image/*';
    const wildcardTiff = '*/tiff';
    const unsupportedFormat = 'text/plain';
    const query = { granuleId };
    const reprojectionQuery = { granuleId, outputCrs: 'EPSG:4326' };

    describe('when providing an accept header for an unsupported format', function () {
      const headers = { accept: unsupportedFormat };
      hookRangesetRequest(version, collection, 'all', { headers, query });
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
      const pngQuery = { granuleId, format: png };
      const headers = { accept: tiff };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { query: pngQuery, headers });
      it('gives the format parameter precedence over the accept header', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
    });

    describe('when providing */* for the accept header', function () {
      const headers = { accept: anyWildcard };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('chooses the first output format supported by the service (see services.yml)', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing */tiff for the accept header', function () {
      const headers = { accept: imageWildcard };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('selects the first valid tiff format supported', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing image/* for the accept header', function () {
      const headers = { accept: wildcardTiff };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('selects the first valid image format supported', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });

    describe('when providing an accept header with a parameter', function () {
      const headers = { accept: `${png};q=0.9` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, 'all', { headers, query });
      it('correctly parses the format from the header', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
    });

    describe('when providing multiple formats supported by different services', function () {
      const headers = { accept: `${netcdf}, ${tiff}` };
      describe('when requesting variable subsetting which is only supported by one of the services', function () {
        // service-example supports reprojection and variable subsetting,
        // swath-projector does not support variable subsetting.
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookRangesetRequest(version, collection, variableName, { headers, query: reprojectionQuery });
        it('uses the backend service that supports variable subsetting', function () {
          expect(this.service.config.name).to.equal('harmony/service-example');
        });
        it('chooses the tiff format since netcdf is not supported by the variable subsetting service', function () {
          expect(this.service.operation.outputFormat).to.equal(tiff);
        });
      });

      describe('when not requesting variable subsetting so either service could be used', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookRangesetRequest(version, collection, 'all', { headers, query: reprojectionQuery });
        it('uses the first format in the list', function () {
          expect(this.service.operation.outputFormat).to.equal(netcdf);
        });
        it('uses the backend service that supports that output format', function () {
          expect(this.service.config.name).to.equal('sds/swath-projector');
        });
      });
    });

    describe('when providing multiple formats with the highest priority being unsupported', function () {
      const headers = { accept: `${unsupportedFormat};q=1.0, ${netcdf};q=0.5, ${tiff};q=0.8, ${png};q=0.85` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('uses the highest quality value format that is supported', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
      it('uses the correct backend service', function () {
        expect(this.service.config.name).to.equal('harmony/service-example');
      });
    });

    describe('when providing multiple formats and not specifying a quality value for one of them', function () {
      const headers = { accept: `${netcdf};q=0.5, ${tiff};q=0.8, ${png}` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('treats the unspecified quality value as 1.0', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
    });

    describe('when requesting an unsupported format followed by */*', function () {
      const headers = { accept: `${unsupportedFormat}, ${anyWildcard}` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('returns a redirect 303 (and not a 404 error)', function () {
        expect(this.res.status).to.equal(303);
      });

      it('chooses the first output format supported by the service (see services.yml)', function () {
        expect(this.service.operation.outputFormat).to.equal(tiff);
      });
    });
  });

  describe('when requesting no data transformations', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, 'all');
    it('selects the download link service to process the request', function () {
      expect(this.service.config.name).to.equal('harmony/download');
    });
  });

  describe('when the database catches fire during an asynchronous request', function () {
    hookDatabaseFailure();
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableName, {});

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
      queryParams: object, message: string, code = 'openapi.ValidationError', variable = variableName,
    ): void {
      it(`returns an HTTP 400 "Bad Request" error with explanatory message ${message}`, async function () {
        const res = await rangesetRequest(
          this.frontend,
          version,
          collection,
          variable,
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
      { granuleId: 'G123-BOGUS' },
      'No matching granules found.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId: '' },
      'query parameter "granuleId[0]" should NOT be shorter than 1 characters',
    );
    itReturnsAValidationError(
      { granuleId, outputCrs: 'EPSG:1' },
      'query parameter "crs/outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,250,330' },
      'query parameter "scaleExtent" should NOT have more than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100' },
      'query parameter "scaleExtent" should NOT have fewer than 4 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleExtent: '1,55,100,nonsense' },
      'query parameter "scaleExtent[3]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5' },
      'query parameter "scaleSize" should NOT have fewer than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,3,35' },
      'query parameter "scaleSize" should NOT have more than 2 items',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '1.5,nonsense' },
      'query parameter "scaleSize[1]" should be number',
    );
    itReturnsAValidationError(
      { granuleId, scaleSize: '-1.3,55.3' },
      'query parameter "scaleSize[0]" should be >= 0',
    );
    itReturnsAValidationError({ granuleId, width: 0 }, 'query parameter "width" should be >= 1');
    itReturnsAValidationError({ granuleId, height: 0 }, 'query parameter "height" should be >= 1');
    // See util-parameter-parsing.js spec for full details on spatial and temporal subset validation
    itReturnsAValidationError(
      { granuleId, subset: 'lat(nonsense:20)' },
      'query parameter "subset" subset dimension "lat" has an invalid numeric value "nonsense"',
      'harmony.RequestValidationError',
    );
    itReturnsAValidationError(
      { granuleId, subset: 'time("nonsense":"2010-01-01T01:00:00Z")' },
      'query parameter "subset" subset dimension "time" has an invalid date time "nonsense"',
      'harmony.RequestValidationError',
    );

    it('returns an HTTP 400 "Bad Request" error with explanatory message when the variable does not exist', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        'NotAVariable',
        { query: { granuleId } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Coverages were not found for the provided variables: NotAVariable',
      });
    });

    it('returns an HTTP 400 "Bad Request" error with explanatory message when "all" is specified with another coverage', async function () {
      const res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        `all,${variableName}`,
        { query: { granuleId } },
      );
      expect(res.status).to.equal(400);
      expect(res.body).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: "all" cannot be specified alongside other variables',
      });
    });
  });

  describe('when using a collection with coordinate variables', function () {
    const collectionId = 'C1243747507-EEDTEST';
    StubService.hook({ params: { redirect: 'http://example.com' } });

    hookRangesetRequest(version, collectionId, 'sea_surface_temperature', {});

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

describe('OGC API Coverages - getCoverageRangeset with the extend query parameter', async function () {
  hookServersStartStop();
  hookRangesetRequest('1.0.0', 'C1233800302-EEDTEST', 'all', { query: { extend: 'dimension_var', skipPreview: 'true', maxResults: 2 }, username: 'joe' });

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
  //   hookRangesetRequest('1.0.0', 'C1233800302-EEDTEST', 'all', { query: { extend: 'dimension_var', skipPreview: 'true', maxResults: 2 }, username: 'joe' });
  //   itRedirectsToJobStatusUrl();
  // });

  // describe('when requesting red_var and extending lat,lon', function () {
  //   StubService.hook({ params: { redirect: 'http://example.com' } });
  //   hookRangesetRequest('1.0.0', 'C1233800302-EEDTEST', 'red_var', { query: { extend: 'lat,lon' }, username: 'joe' });
  //   itRedirectsToJobStatusUrl();
  // });
});

describe('OGC API Coverages - getCoverageRangeset with a collection not configured for services', function () {
  const collection = 'C1243745256-EEDTEST';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when not requesting any transformations', function () {
    hookRangesetRequest(version, collection, 'all', { username: 'joe' });
    itRedirectsToJobStatusUrl();
  });

  describe('when requesting any transformation such as reformatting to png', function () {
    hookRangesetRequest(version, collection, 'all', { username: 'joe', query: { format: 'image/png' } });

    it('returns a 422 error response', function () {
      expect(this.res.status).to.equal(422);
    });

    it('returns an error message indicating the transformation could not be performed', function () {
      const body = JSON.parse(this.res.text);
      expect(body).to.eql({
        code: 'harmony.UnsupportedOperation',
        description: 'Error: the requested combination of operations: reformatting to image/png on C1243745256-EEDTEST is unsupported',
      });
    });

  });
});
