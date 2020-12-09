/* eslint-disable max-len */
import { parse } from 'cookie';
import * as fetch from 'node-fetch';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Response, Test } from 'supertest';
import * as fs from 'fs';
import isUUID from 'util/uuid';
import { Application } from 'express';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';
import { auth } from '../helpers/auth';
import { rangesetRequest, postRangesetRequest, hookPostRangesetRequest, stripSignature } from '../helpers/ogc-api-coverages';
import hookCmr from '../helpers/stub-cmr';
import { getJson } from '../helpers/object-store';

/**
 * Common steps in the validation tests
 *
 * @param app - The express application
 * @param res - The response object
 * @param version - The OGC version
 * @param collection - The collection id
 * @param variableName - The variable name
 * @returns the response from the request
 */
function commonValidationSteps(
  app: Application, res: Response, version: string, collection: string, variableName: string,
): Test {
  const shapefileHeader = res.header['set-cookie'].filter((cookie) => {
    const decoded = decodeURIComponent(cookie);
    const parsed = parse(decoded);
    return parsed.shapefile;
  })[0];
  const decoded = decodeURIComponent(shapefileHeader);
  const parsed = parse(decoded);
  const cookieValue = stripSignature(parsed.shapefile);
  const cookies = { shapefile: cookieValue };
  // we 'follow' the redirect from EDL
  return rangesetRequest(app, version, collection, variableName, { query: res.body, cookies })
    .use(auth({ username: 'fakeUsername', extraCookies: cookies }));
}

describe('OGC API Coverages - getCoverageRangeset with shapefile', function () {
  const collection = 'C1233800302-EEDTEST';
  const expectedGranuleId = 'G1233800352-EEDTEST';
  const expectedVariableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';

  hookServersStartStop({ skipEarthdataLogin: false });

  const cmrRespStr = fs.readFileSync('./test/resources/africa_shapefile_post_response.json');
  const cmrResp = JSON.parse(cmrRespStr.toString());
  const testGeoJson = JSON.parse(fs.readFileSync('./test/resources/complex_multipoly.geojson').toString());

  describe('when provided a valid set of field parameters', function () {
    const form = {
      subset: ['lon(17:98)', 'time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      outputCrs: 'EPSG:4326',
    };

    describe('and a valid GeoJSON shapefile', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/complex_multipoly.geojson', mimetype: 'application/geo+json' } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      cmrResp.headers = new fetch.Headers(cmrResp.headers);
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

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

      it('passes the outputCrs parameter to the backend via srs object', function () {
        expect(this.service.operation.srs.proj4).to.equal('+proj=longlat +datum=WGS84 +no_defs');
        expect(this.service.operation.srs.wkt).to.equal('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]');
        expect(this.service.operation.srs.epsg).to.equal('EPSG:4326');
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

      it('passes a shapefile URI to the backend', async function () {
        expect(this.service.operation.geojson).to.match(new RegExp('^s3://[^/]+/temp-user-uploads/[^/]+$'));

        const geojson = await getJson(this.service.operation.geojson);
        expect(geojson).to.deep.equal(testGeoJson);
      });
    });

    describe('and a valid ESRI shapefile', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/complex_multipoly.zip', mimetype: 'application/shapefile+zip' } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('correctly identifies the granules based on the shapefile', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(expectedGranuleId);
      });

      it('passes a URL to the ESRI Shapefile converted to GeoJSON to the backend', async function () {
        expect(this.service.operation.geojson).to.match(new RegExp('^s3://[^/]+/temp-user-uploads/[^/]+.geojson$'));

        const geojson = await getJson(this.service.operation.geojson);
        // Ignore helpful bbox and filename attributes added from ESRI Shapefile
        delete geojson.features[0].geometry.bbox;
        delete geojson.features[1].geometry.bbox;
        delete geojson.fileName;

        // Round coordinates to 6 decimal places to deal with floating point representation differences
        for (const feature of geojson.features) {
          feature.geometry.coordinates = feature.geometry.coordinates.map((c) => c.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]));
        }
        expect(geojson).to.deep.equal(testGeoJson);
      });
    });

    describe('and an ESRI shapefile containing more than one .shp', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/two_shp_file.zip', mimetype: 'application/shapefile+zip' } };
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('returns a shapefile conversion error', function () {
        expect(this.res.status).to.equal(400);
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: The provided ESRI Shapefile file could not be parsed. Please check its validity before retrying.',
        });
      });
    });

    describe('and an ESRI shapefile that cannot be parsed', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/corrupt_file.zip', mimetype: 'application/shapefile+zip' } };
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('returns a shapefile conversion error', function () {
        expect(this.res.status).to.equal(400);
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: The provided ESRI Shapefile file could not be parsed. Please check its validity before retrying.',
        });
      });
    });

    describe('and a valid KML shapefile', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/complex_multipoly.kml', mimetype: 'application/vnd.google-earth.kml+xml' } };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookCmr('fetchPost', cmrResp);
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('correctly identifies the granules based on the shapefile', function () {
        const source = this.service.operation.sources[0];
        expect(source.granules.length === 1);
        expect(source.granules[0].id).to.equal(expectedGranuleId);
      });

      it('passes a URL to the KML converted to GeoJSON to the backend', async function () {
        expect(this.service.operation.geojson).to.match(new RegExp('^s3://[^/]+/temp-user-uploads/[^/]+.geojson$'));

        const geojson = await getJson(this.service.operation.geojson);
        for (const feature of geojson.features) { // Adapt null vs undefined id property
          feature.properties.id = feature.properties.id || null;
        }
        expect(geojson).to.deep.equal(testGeoJson);
      });
    });

    describe('and a KML shapefile that cannot be parsed', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/corrupt_file.kml', mimetype: 'application/vnd.google-earth.kml+xml' } };
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('returns a shapefile conversion error', function () {
        expect(this.res.status).to.equal(400);
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: The provided KML file could not be parsed. Please check its validity before retrying.',
        });
      });
    });

    describe('and an unrecognized shapefile type', function () {
      const shapeForm = { ...form, shapefile: { path: './test/resources/corrupt_file.kml', mimetype: 'text/plain' } };
      hookPostRangesetRequest(version, collection, variableName, shapeForm);

      it('returns a shapefile conversion error', function () {
        expect(this.res.status).to.equal(400);
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Unrecognized shapefile type "text/plain".  Valid types are "application/geo+json" (GeoJSON), "application/vnd.google-earth.kml+xml" (KML), and "application/shapefile+zip" (ESRI Shapefile)',
        });
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
            path: './test/resources/complex_multipoly.geojson',
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
      const cmrErrorMessage = 'Corrupt GeoJSON';
      const cmrStatus = 400;
      hookCmr('cmrPostSearchBase', { status: cmrStatus, data: { errors: [cmrErrorMessage] } });
      it('returns an HTTP 400 "Bad Request" error with message reflecting the original shapefile type',
        async function () {
          let res = await postRangesetRequest(
            this.frontend,
            version,
            collection,
            variableName,
            { shapefile: { path: './test/resources/complex_multipoly.zip', mimetype: 'application/shapefile+zip' } },
          );
          // we get redirected to EDL before the shapefile gets processed
          expect(res.status).to.equal(303);

          // we fake and follow the EDL response here
          res = await commonValidationSteps(this.frontend, res, version, collection, variableName);

          expect(res.status).to.equal(cmrStatus);
          expect(res.body).to.eql({
            code: 'harmony.CmrError',
            description: 'Error: Corrupt GeoJSON (converted from the provided ESRI Shapefile)',
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
          { shapefile: { path: './test/resources/complex_multipoly.geojson', mimetype: 'application/geo+json' } },
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
