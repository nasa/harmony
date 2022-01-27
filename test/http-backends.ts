import { describe, it } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from './helpers/servers';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import { eossGetGranule } from './helpers/eoss';
import { hookFunction } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookCmr from './helpers/stub-cmr';
import _ from 'lodash';
import StubService from './helpers/stub-service';

/**
 * Define common test cases for HTTP backends that don't vary by access protocol.
 *
 * @param performRequestFn - A function that takes a string CRS and performs a frontend
 *   request with it, returning a promise for the superagent response
 */
function describeHttpBackendBehavior(performRequestFn: Function): void {
  describe('a service success response', function () {
    hookFunction(performRequestFn, 'res', 'EPSG:4326');

    it('propagates the service response verbatim to the user', function () {
      expect(this.res.body.format.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
    });

    it('returns a 200 OK status code to the user', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('propagates the service response Content-Type to the user', function () {
      expect(this.res.headers['content-type']).to.equal('application/json; charset=utf-8');
    });

    it('propagates the service response Content-Length to the user', function () {
      expect(this.res.headers['content-length']).to.equal(`${this.res.text.length}`);
    });
  });

  describe('a service redirect response', function () {
    hookFunction(performRequestFn, 'res', 'REDIRECT');

    it('redirects to the location provided in the Location header', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.equal('/example/redirected');
    });
  });

  describe('a service client error response', function () {
    hookFunction(performRequestFn, 'res', 'ERROR:422');

    it('propagates the message to the user', function () {
      expect(this.res.text).to.contain('An intentional error occurred');
    });

    it('propagates the status code to the user', function () {
      expect(this.res.statusCode).to.equal(422);
    });
  });

  describe('a service server error response', function () {
    hookFunction(performRequestFn, 'res', 'ERROR:501');

    it('propagates the message to the user', function () {
      expect(this.res.text).to.contain('An intentional error occurred');
    });

    it('propagates the status code to the user', function () {
      expect(this.res.statusCode).to.equal(501);
    });
  });
}

describe('HTTP Backends', function () {
  const collection = 'C1104-PVC_TS2';
  const granule = 'G1216319051-PVC_TS2';
  const query = { granuleId: granule };
  const version = '1.0.0';

  hookServersStartStop();

  describe('when accessed via WMS', function () {
    describeHttpBackendBehavior(function (crs) {
      return wmsRequest(this.frontend, collection, { ...validGetMapQuery, crs, layers: collection })
        .ok(() => true); // Treat all responses as non-errors to allow checking status code
    });
  });

  describe('when accessed via EOSS', function () {
    describeHttpBackendBehavior(function (crs) {
      return eossGetGranule(this.frontend, '0.1.0', collection, granule, { crs })
        .ok(() => true);
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
      id: collection,
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
        id: 'G1235282638-ASF',
        original_format: 'UMM_JSON',
        granule_size: '1.0242048E7',
        browse_flag: false,
        collection_concept_id: collection,
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
    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'polygons'], [['0 35 0 40 10 40 10 35 0 35']]);
    hookCmr('queryGranulesForCollection', cmrResp);
    describe('calling the backend service', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([35, 0, 40, 10.00933429]);
      });
    });
  });

  describe('when the granule spatial metadata is defined by lines instead of a bbox', function () {
    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'lines'], ['0 35 10 50']);
    hookCmr('queryGranulesForCollection', cmrResp);
    describe('calling the backend service', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([35, 0, 50, 10]);
      });
    });
  });

  describe('when the granule spatial metadata is defined by points instead of a bbox', function () {
    const cmrResp = _.set(_.cloneDeep(cmrGranuleResp), ['granules', 0, 'points'], ['0, 35']);

    describe('calling the backend service', function () {
      hookCmr('queryGranulesForCollection', cmrResp);
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, 'all', { query });

      it('adds a bbox field to the granule', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules[0].bbox).to.eql([34.99999999, -1e-8, 35.00000001, 1e-8]);
      });
    });
  });

  describe('when the granule spatial metadata does not exist', function () {
    describe('calling the backend service', function () {
      const cmrCollSpatialResp = _.set(_.cloneDeep(cmrCollResp), [0, 'boxes'], ['-70 -120 70 120']);

      hookCmr('getCollectionsByIds', cmrCollSpatialResp);
      hookCmr('queryGranulesForCollection', cmrGranuleResp);
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, 'all', { query });
      describe('and the collection has spatial metadata', function () {
        it('uses the collection spatial', function () {
          const source = this.service.operation.sources[0];
          expect(source.granules[0].bbox).to.eql([-120, -70, 120, 70]);
        });
      });
    });
  });

  describe('when the granule spatial metadata does not exist', function () {
    describe('calling the backend service', function () {
      hookCmr('getCollectionsByIds', cmrCollResp);
      hookCmr('queryGranulesForCollection', cmrGranuleResp);
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, 'all', { query });
      describe('and the collection has no spatial metadata', function () {
        it('uses a whole world bounding box', function () {
          const source = this.service.operation.sources[0];
          expect(source.granules[0].bbox).to.eql([-180, -90, 180, 90]);
        });
      });
    });
  });
});
