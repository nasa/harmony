import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookCmr from 'harmony-test/stub-cmr';
import _ from 'lodash';
import isUUID from '../../app/util/uuid';
import { itIncludesRequestUrl } from '../helpers/jobs';
import { hookSignS3Object } from '../helpers/object-store';
import { hookRangesetRequest, rangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';


describe('OGC API Coverages - getCoverageRangeset', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleId = 'G1233800352-EEDTEST';
  const variableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    const query = {
      granuleId,
      outputCrs: 'CRS:84',
      subset: ['lat(0:10)', 'lon(-20.1:20)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
      interpolation: 'near',
      // TODO: it might only make sense to include width and height with a scaleExtent
      // and scaleSize by itself
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      format: 'image/png',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { query });

      it('provides a staging location to the backend', function () {
        const location = this.service.operation.stagingLocation;
        expect(location).to.match(new RegExp('^s3://[^/]+/public/harmony/stub/[^/]+/$'));
      });

      it('passes the source collection to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
      });

      it('passes the source variable to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length === 1);
        expect(source.variables[0].id).to.equal(variableId);
      });

      it('passes the source granule to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(granuleId);
      });

      it('adds the bbox field to the granules', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([-180.0, -90.0, 180.0, 90.0]);
      });

      it('adds the temporal field to the granules', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].temporal).to.eql({
          start: '2020-01-02T00:00:00.000Z',
          end: '2020-01-02T01:59:59.000Z',
        });
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
      hookRangesetRequest(version, collection, variableName, { query });

      it('propagates the error message into the response', function () {
        expect(this.res.text).to.include('Something bad happened');
      });

      it('responds with an HTTP 400 "Bad Request" status code', function () {
        expect(this.res.status).to.equal(400);
      });
    });

    describe('and the backend service calls back with a redirect', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { query });

      it('redirects the client to the provided URL', function () {
        expect(this.res.status).to.equal(303);
        expect(this.res.headers.location).to.equal('http://example.com');
      });
    });

    describe('and the backend service calls back with a redirect to an S3 location', function () {
      const signedPrefix = hookSignS3Object();
      StubService.hook({ params: { redirect: 's3://my-bucket/public/my-object.tif' } });
      hookRangesetRequest(version, collection, variableName, { query });

      it('redirects the client to a presigned url', function () {
        expect(this.res.status).to.equal(303);
        expect(this.res.headers.location).to.include(signedPrefix);
        expect(this.res.headers.location).to.include('anonymous');
      });
    });

    describe('and the backend service provides POST data', function () {
      StubService.hook({
        body: 'realistic mock data',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      hookRangesetRequest(version, collection, variableName, { query });

      it('returns an HTTP 200 "OK" status code', function () {
        expect(this.res.status).to.equal(200);
      });

      it('propagates the Content-Type header to the client', function () {
        expect(this.res.headers['content-type']).to.equal('text/plain; charset=utf-8');
      });
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

  describe('Subsetting multiple variables', function () {
    const variableNames = 'red_var,green_var';
    const query = {
      granuleId,
    };
    const variableId1 = 'V1233801695-EEDTEST';
    const variableId2 = 'V1233801696-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableNames, { query });

    it('passes multiple variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 2);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
    });
  });

  describe('Specifying the full path for a variable', function () {
    // GroupPath = '/', Name = 'alpha_var', so full path is '/' + '/' + 'alpha_var' = '//alpha_var'
    const fullPath = '//alpha_var';
    const query = {
      granuleId,
    };
    const variableId1 = 'V1233801717-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, fullPath, { query });

    it('passes a matching variable to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 1);
      expect(source.variables[0].id).to.equal(variableId1);
    });
  });

  describe('Specifying a full path with other variables', function () {
    const mixedPaths = 'green_var,//alpha_var,red_var';
    const query = {
      granuleId,
    };
    const variableId1 = 'V1233801696-EEDTEST';
    const variableId2 = 'V1233801717-EEDTEST';
    const variableId3 = 'V1233801695-EEDTEST';

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, mixedPaths, { query });

    it('passes matching variables to the backend service', function () {
      const source = this.service.operation.sources[0];
      expect(source.variables.length === 3);
      expect(source.variables[0].id).to.equal(variableId1);
      expect(source.variables[1].id).to.equal(variableId2);
      expect(source.variables[2].id).to.equal(variableId3);
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

  describe('Not specifying a single granule ID', function () {
    const query = {};

    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest(version, collection, variableName, { query });

    it('is processed asynchronously', function () {
      expect(this.service.operation.isSynchronous).to.equal(false);
    });

    it('returns a redirect to the job status URL', function () {
      const { status, headers } = this.res;
      const { location } = headers;
      expect(status).to.equal(303);
      expect(location).to.match(/^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('when provided a valid temporal range', function () {
    const query = {
      outputCrs: 'CRS:84',
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

      it('identifies the correct granule based on time range', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal('G1233800352-EEDTEST');
      });
    });
  });

  describe('when the granule spatial metadata is defined by polygons instead of a bbox', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
      subset: ['lat(-45.75:45)', 'lon(-90:90)'],
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });

      it('synchronously makes the request', function () {
        expect(this.service.operation.isSynchronous).to.equal(true);
      });

      it('passes the subset parameters to the backend service', function () {
        expect(this.service.operation.boundingRectangle).to.eql([-90, -45.75, 90, 45]);
      });
    });
  });

  const cmrCollResp = [
    {
      processing_level_id: '2P',
      time_start: '2012-07-02T19:00:44.000Z',
      version_id: '1',
      updated: '2017-09-18T17:57:41.242Z',
      dataset_id: 'PODAAC-GHAM2-2PR8A',
      has_spatial_subsetting: true,
      has_transforms: false,
      associations: {
        variables: [
          'V1229850953-POCUMULUS',
        ],
        services: ['S1233603906-EEDTEST'],
      },
      has_variables: true,
      data_center: 'POCUMULUS',
      short_name: 'AMSR2-REMSS-L2P-v8a',
      organizations: ['PO.DAAC', 'Remote Sensing Systems'],
      title: 'PODAAC-GHAM2-2PR8A',
      coordinate_system: 'CARTESIAN',
      summary: 'A summary',
      orbit_parameters: {},
      id: 'C1225996408-POCUMULUS',
      has_formats: true,
      original_format: 'UMM_JSON',
      archive_center: 'PO.DAAC',
      has_temporal_subsetting: false,
      browse_flag: false,
      online_access_flag: true,
      links: [
        {
          rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
          hreflang: 'en-US',
          href: 'http://data.nodc.noaa.gov/cgi-bin/nph-dods/ghrsst/GDS2/L2P/AMSR2/REMSS/v8a/',
        },
      ],
    },
  ];

  const cmrGranuleResp = {
    hits: 1,
    granules: [
      {
        time_start: '2018-01-01T04:16:00.000Z',
        dataset_id: 'PODAAC-GHAM2-2PR8A',
        data_center: 'POCUMULUS',
        title: '20180101041600-REMSS-L2P_GHRSST-SSTsubskin-AMSR2-L2B_rt_r29920-v02.0-fv01.0.nc',
        coordinate_system: 'CARTESIAN',
        day_night_flag: 'UNSPECIFIED',
        time_end: '2018-01-01T05:54:08.000Z',
        id: 'G1226018995-POCUMULUS',
        original_format: 'UMM_JSON',
        granule_size: '1.0242048E7',
        browse_flag: false,
        collection_concept_id: 'C1225996408-POCUMULUS',
        online_access_flag: true,
        links: [
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            hreflang: 'en-US',
            href: 'http://data.nodc.noaa.gov/cgi-bin/nph-dods/ghrsst/foo',
          },
        ],
      },
    ],
  };

  describe('when the granule spatial metadata is defined by polygons instead of a bbox', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
    };

    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'polygons'], [['0 35 0 40 10 40 10 35 0 35']]);
    hookCmr('queryGranulesForCollection', cmrResp);
    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });

      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([35, 0, 40, 10.00933429]);
      });
    });
  });

  describe('when the granule spatial metadata is defined by lines instead of a bbox', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
    };

    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'lines'], ['0 35 10 50']);
    hookCmr('queryGranulesForCollection', cmrResp);
    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([35, 0, 50, 10]);
      });
    });
  });

  describe('when the granule spatial metadata is defined by points instead of a bbox', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
    };

    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'points'], ['0, 35']);

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('queryGranulesForCollection', cmrResp);
      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([34.99999999, -1e-8, 35.00000001, 1e-8]);
      });
    });
  });

  describe('when the granule spatial metadata does not exist', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      const cmrCollSpatialResp = _.set(_.cloneDeep(cmrCollResp), [0, 'boxes'], ['-70 -120 70 120']);

      hookCmr('getCollectionsByIds', cmrCollSpatialResp);
      hookCmr('queryGranulesForCollection', cmrGranuleResp);
      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });
      describe('and the collection has spatial metadata', function () {
        it('uses the collection spatial', function () {
          const source = this.service.operation.sources[0];
          expect(source.granules[0].bbox).to.eql([-120, -70, 120, 70]);
        });
      });
    });
  });

  describe('when the granule spatial metadata does not exist', function () {
    const query = {
      granuleid: 'G1226018995-POCUMULUS',
    };

    describe('calling the backend service', function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('getCollectionsByIds', cmrCollResp);
      hookCmr('queryGranulesForCollection', cmrGranuleResp);
      hookRangesetRequest(version, 'C1225996408-POCUMULUS', 'all', { query });
      describe('and the collection has no spatial metadata', function () {
        it('uses a whole world bounding box', function () {
          const source = this.service.operation.sources[0];
          expect(source.granules[0].bbox).to.eql([-180, -90, 180, 90]);
        });
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
    const query = { granuleId };

    describe('when providing an accept header for an unsupported format', function () {
      const headers = { accept: unsupportedFormat };
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('returns a 200 successful response', function () {
        expect(this.res.status).to.equal(200);
      });
      it('indicates the format as the reason the no op service was used', function () {
        const noOpResponse = JSON.parse(this.res.text);
        expect(noOpResponse.message).to.equal('Returning direct download links because none of the services configured for the collection support reformatting to any of the requested formats [text/plain].');
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
      const headers = { accept: `${zarr};q=0.9` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, 'all', { headers, query });
      it('correctly parses the format from the header', function () {
        expect(this.service.operation.outputFormat).to.equal(zarr);
      });
    });

    describe('when providing multiple formats supported by different services', function () {
      const headers = { accept: `${zarr}, ${tiff}` };
      describe('when requesting variable subsetting which is only supported by one of the services', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookRangesetRequest(version, collection, variableName, { headers, query });
        it('uses the backend service that supports variable subsetting', function () {
          expect(this.service.name).to.equal('harmony/gdal');
        });
        it('chooses the tiff format since zarr is not supported by the variable subsetting service', function () {
          expect(this.service.operation.outputFormat).to.equal(tiff);
        });
      });

      describe('when not requesting variable subsetting so either service could be used', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookRangesetRequest(version, collection, 'all', { headers, query });
        it('uses the first format in the list', function () {
          expect(this.service.operation.outputFormat).to.equal(zarr);
        });
        it('uses the backend service that supports that output format', function () {
          expect(this.service.name).to.equal('harmony/netcdf-to-zarr');
        });
      });
    });

    describe('when providing multiple formats with the highest priority being unsupported', function () {
      const headers = { accept: `${unsupportedFormat};q=1.0, ${zarr};q=0.5, ${tiff};q=0.8, ${png};q=0.85` };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest(version, collection, variableName, { headers, query });
      it('uses the highest quality value format that is supported', function () {
        expect(this.service.operation.outputFormat).to.equal(png);
      });
      it('uses the correct backend service', function () {
        expect(this.service.name).to.equal('harmony/gdal');
      });
    });

    describe('when providing multiple formats and not specifying a quality value for one of them', function () {
      const headers = { accept: `${zarr};q=0.5, ${tiff};q=0.8, ${png}` };
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

  /*
  FIXME: HARMONY-293 - Commenting out now because this is a low priority edge case holding up high
  priority work

  describe('when the database catches fire during an asynchronous request', function () {
    before(function () {
      const testdb = path.resolve(__dirname, '../../db/test.sqlite3');
      fs.unlinkSync(testdb);
    });

    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(version, collection, variableName, {});

    after(async function () {
      // Get a new connection
      await knex(db.client.config).migrate.latest();
    });

    it('returns an HTTP 500 error with the JSON error format', function () {
      expect(this.res.status).to.eql(500);
      const body = JSON.parse(this.res.text);
      expect(body).to.eql({
        code: 'harmony.ServerError',
        description: 'Error: Failed to save job to database.',
      });
    });
  });
  */

  describe('when the backend service does not respond', function () {
    // Starting up docker image can take more than 2 seconds
    this.timeout(10000);
    StubService.hookDockerImage('alpine:3.10.3');
    hookRangesetRequest(version, collection, variableName, { query: { granuleId } });

    it('returns an error to the client', async function () {
      expect(this.res.text).to.include('Service request failed with an unknown error.');
    });
  });

  describe('Validation', function () {
    /**
     * Creates an it assertion that the passed in query causes a 400 validation error
     * with the given error message
     *
     * @param {Object} queryParams The query parameters to send to the request
     * @param {String} message The error message that should be returned
     * @param {String} code The error code of the message
     * @returns {void}
     */
    function itReturnsAValidationError(
      queryParams: object, message: string, code = 'openapi.ValidationError',
    ): void {
      it(`returns an HTTP 400 "Bad Request" error with explanatory message ${message}`, async function () {
        const res = await rangesetRequest(
          this.frontend,
          version,
          collection,
          variableName,
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
      'query parameter "outputCrs" could not be parsed.  Try an EPSG code or Proj4 string.',
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
        description: 'Error: Coverages were not found for the provided CMR collection: NotAVariable',
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
});

const expectedNoOpJobKeys = [
  'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request',
];

describe('OGC API Coverages - getCoverageRangeset with a collection not configured for services', function () {
  const collection = 'C446398-ORNL_DAAC';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when provided a valid set of parameters', function () {
    hookRangesetRequest(version, collection, 'all', { username: 'joe' });

    it('returns a 200 successful response', function () {
      expect(this.res.status).to.equal(200);
    });
    it('returns a JSON body in the format of a job status without a job ID', function () {
      const job = JSON.parse(this.res.text);
      expect(Object.keys(job)).to.eql(expectedNoOpJobKeys);
    });
    it('returns a successful status', function () {
      const job = JSON.parse(this.res.text);
      expect(job.status).to.eql('successful');
    });
    it('returns 100 for progress', function () {
      const job = JSON.parse(this.res.text);
      expect(job.progress).to.eql(100);
    });
    it('returns a message when results are truncated', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.eql('Returning direct download links because no services are configured for the collection. CMR query identified 117 granules, but the request has been limited to process only the first 20 granules.');
    });
    it('returns granule links', function () {
      const job = JSON.parse(this.res.text);
      expect(job.links.length).to.equal(20);
    });
    it('granule links include a title of the granuleId', function () {
      const job = JSON.parse(this.res.text);
      expect(job.links[0].title).to.equal('G1220944164-ORNL_DAAC');
    });
    it('granule links include a download link', function () {
      const job = JSON.parse(this.res.text);
      expect(job.links[0].href).to.not.equal(undefined);
    });

    itIncludesRequestUrl('/C446398-ORNL_DAAC/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset');
  });

  describe('when using accept headers', function () {
    describe('*/*', function () {
      hookRangesetRequest(version, collection, 'all', { headers: { accept: '*/*' } });
      it('returns a 200 successful response', function () {
        expect(this.res.status).to.equal(200);
      });
      it('returns a JSON body in the format of a job status without a job ID', function () {
        const job = JSON.parse(this.res.text);
        expect(Object.keys(job)).to.eql(expectedNoOpJobKeys);
      });
    });
    describe('application/json', function () {
      hookRangesetRequest(version, collection, 'all', { headers: { accept: 'application/json' } });
      it('returns a 200 successful response', function () {
        expect(this.res.status).to.equal(200);
      });
      it('returns a JSON body in the format of a job status without a job ID', function () {
        const job = JSON.parse(this.res.text);
        expect(Object.keys(job)).to.eql(expectedNoOpJobKeys);
      });
    });
  });

  describe('when only one granule is identified', function () {
    const collectionWithSingleGranule = 'C1000000099-ORNL_DAAC';
    hookRangesetRequest(version, collectionWithSingleGranule, 'all', {});

    it('returns a 200 successful response', function () {
      expect(this.res.status).to.equal(200);
    });
    it('returns a JSON body in the format of a job status without a job ID', function () {
      const job = JSON.parse(this.res.text);
      expect(Object.keys(job)).to.eql(expectedNoOpJobKeys);
    });
    it('returns a message indicating no transformations were performed', function () {
      const job = JSON.parse(this.res.text);
      expect(job.message).to.eql('Returning direct download links because no services are configured for the collection.');
    });
  });

  describe('when performing spatial and temporal subsetting', function () {
    const query = {
      subset: ['lat(30:40)', 'lon(-100:0)', 'time("1987-05-29T00:00Z":"1987-05-30T00:00Z")'],
    };
    hookRangesetRequest(version, collection, 'all', { query });

    it('returns a 200 successful response', function () {
      expect(this.res.status).to.equal(200);
    });
    it('returns a JSON body in the format of a job status without a job ID', function () {
      const job = JSON.parse(this.res.text);
      expect(Object.keys(job)).to.eql(expectedNoOpJobKeys);
    });
    it('limits results to only those that match the spatial and temporal subset', function () {
      const job = JSON.parse(this.res.text);
      expect(job.links.length).to.equal(10);
    });

    itIncludesRequestUrl('C446398-ORNL_DAAC/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?subset=lat(30%3A40)&subset=lon(-100%3A0)&subset=time(%221987-05-29T00%3A00Z%22%3A%221987-05-30T00%3A00Z%22)');
  });

  describe('when specifying an invalid variable', function () {
    hookRangesetRequest(version, collection, 'badVar', {});

    it('returns a 400 error', function () {
      expect(this.res.status).to.equal(400);
    });
    it('includes an error message indicating the bad variable name', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Coverages were not found for the provided CMR collection: badVar',
      });
    });
  });
});
