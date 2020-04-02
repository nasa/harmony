/* eslint-disable max-len */
const { parse } = require('cookie');
const fetch = require('node-fetch');
const { describe, it, xit } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const { hookServersStartStop } = require('../helpers/servers');
const StubService = require('../helpers/stub-service');
const { auth } = require('../helpers/auth');
const { rangesetRequest, postRangesetRequest, hookPostRangesetRequest, stripSignature } = require('../helpers/ogc-api-coverages');
const { hookCmr } = require('../helpers/stub-cmr');
const isUUID = require('../../app/util/uuid');
const { hookMockS3 } = require('../helpers/object-store');

/**
 * Common steps in the validation tests
 *
 * @param {Object} app The express application
 * @param {Response} res The response object
 * @param {string} version The OGC version
 * @param {string} collection The collection id
 * @param {string} variableName The variable name
 * @returns {Response} the response from the request
 */
async function commonValidationSteps(app, res, version, collection, variableName) {
  const shapefileHeader = res.headers['set-cookie'].filter((cookie) => {
    const decoded = decodeURIComponent(cookie);
    const parsed = parse(decoded);
    return parsed.shapefile;
  })[0];
  const decoded = decodeURIComponent(shapefileHeader);
  const parsed = parse(decoded);
  const cookieValue = stripSignature(parsed.shapefile);
  const cookies = { shapefile: cookieValue };
  // we 'follow' the redirect from EDL
  return rangesetRequest(app, version, collection, variableName, res.body, cookies).use(auth({ username: 'fakeUsername', extraCookies: cookies }));
}

describe('OGC API Coverages - getCoverageRangeset with shapefile', function () {
  const collection = 'C1233800302-EEDTEST';
  const expectedGranuleId = 'G1233800352-EEDTEST';
  const expectedVariableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';

  hookMockS3();
  hookServersStartStop({ skipEarthdataLogin: false });

  const cmrRespStr = fs.readFileSync('./test/resources/africa_shapefile_post_response.json');
  const cmrResp = JSON.parse(cmrRespStr);

  describe('when provided a valid set of parameters', function () {
    let form = {
      subset: ['lon(17:98)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      outputCrs: 'CRS:84',
      shapefile: { path: './test/resources/southern_africa.zip', mimetype: 'application/shapefile+zip' },
    };

    describe('calling the backend service with a GeoJSON shapefile', function () {
      form = { ...form, shapefile: { path: './test/resources/southern_africa.geojson', mimetype: 'application/geo+json' } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      cmrResp.headers = new fetch.Headers(cmrResp.headers);
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, form);

      it('passes the source collection to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.collection).to.equal(collection);
      });

      it('passes the source variable to the backend', function () {
        const source = this.service.operation.sources[0];
        expect(source.variables.length === 1);
        expect(source.variables[0].id).to.equal(expectedVariableId);
      });

      it('correctly identifies the granules based on the shapefile', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(expectedGranuleId);
      });

      it('passes the outputCrs parameter to the backend in Proj4 format', function () {
        expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
      });

      it('passes the client parameter to the backend', function () {
        expect(this.service.operation.client).to.equal('harmony-test');
      });

      it('passes the user parameter to the backend', function () {
        expect(this.service.operation.user).to.equal('fakeUsername');
      });

      it('passes the synchronous mode parameter to the backend and is set to true', function () {
        expect(this.service.operation.isSynchronous).to.equal(true);
      });

      it('passes the request id parameter to the backend', function () {
        expect(isUUID(this.service.operation.requestId)).to.equal(true);
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
    });

    // TODO Marked as pending as it currently provides no value over GeoJSON (HARMONY-243 will implement)
    describe('calling the backend service with an ESRI shapefile @wip', function () {
      form = { ...form, ...{ shapefile: { path: './test/resources/southern_africa.zip', mimetype: 'application/shapefile+zip' } } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, form);

      it('correctly identifies the granules based on the shapefile', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(expectedGranuleId);
      });
    });

    // TODO Marked as pending as it currently provides no value over GeoJSON (HARMONY-243 will implement)
    describe('calling the backend service with a KML shapefile @wip', function () {
      form = { ...form, ...{ shapefile: { path: './test/resources/southern_africa.kml', mimetype: 'application/vnd.google-earth.kml+xml' } } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, form);

      it('correctly identifies the granules based on the shapefile', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(expectedGranuleId);
      });
    });
  });

  describe('When a user is already authenticated', async function () {
    cmrResp.headers = new fetch.Headers(cmrResp.headers);
    hookCmr('fetchPost', cmrResp);
    StubService.hook({ params: { redirect: 'http://example.com' } });

    it('does not redirect to EDL', async function () {
      const res = await postRangesetRequest(
        this.frontend,
        version,
        collection,
        variableName,
        {
          shapefile: {
            path: './test/resources/southern_africa.geojson',
            mimetype: 'application/geo+json',
          },
          format: 'image/png',
          subset: ['time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
        },
      ).use(auth({ username: 'fakeUsername', extraCookies: {} }));

      expect(res.status).to.equal(303);
      expect(res.text.match(/See Other\. Redirecting to http:\/\/example.com.*/));
    });
  });

  describe('Validation', function () {
    describe('when the CMR returns a 4xx', function () {
      const cmrErrorMessage = 'Corrupt zip file';
      const cmrStatus = 400;
      hookCmr('cmrPostSearchBase', { status: cmrStatus, data: { errors: [cmrErrorMessage] } });
      it('returns an HTTP 400 "Bad Request" error with explanatory message when the shapefile is corrupt',
        async function () {
          let res = await postRangesetRequest(
            this.frontend,
            version,
            collection,
            variableName,
            { shapefile: { path: './test/resources/corrupt_file.geojson', mimetype: 'application/geo+json' } },
          );
          // we get redirected to EDL before the shapefile gets processed
          expect(res.status).to.equal(303);

          // we fake and follow the EDL response here
          res = await commonValidationSteps(this.frontend, res, version, collection, variableName);

          expect(res.status).to.equal(cmrStatus);
          expect(res.body).to.eql({
            code: 'harmony.CmrError',
            description: `Error: ${cmrErrorMessage}`,
          });
        });
    });

    describe('when the CMR returns a 5xx', function () {
      hookCmr('cmrPostSearchBase', { status: 500 });
      it('returns an HTTP 503 "Service unavailable" error', async function () {
        let res = await postRangesetRequest(
          this.frontend,
          version,
          collection,
          variableName,
          { shapefile: { path: './test/resources/southern_africa.geojson', mimetype: 'application/geo+json' } },
        );
        // we get redirected to EDL before the shapefile gets processed
        expect(res.status).to.equal(303);

        // we fake and follow the EDL response here
        res = await commonValidationSteps(this.frontend, res, version, collection, variableName);

        expect(res.status).to.equal(503);
        expect(res.body).to.eql({
          code: 'harmony.CmrError',
          description: 'Error: Service unavailable',
        });
      });
    });
  });
});
