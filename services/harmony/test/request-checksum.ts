import { expect } from 'chai';

import HarmonyRequest from '../app/models/harmony-request';
import { computeRequestChecksum, hashGeoJson } from '../app/util/request-checksum';

/**
 * Builds the minimal request shape `computeRequestChecksum` reads.
 *
 * @param originalUrl - the request path, optionally with a query string that is ignored
 * @param query - the request query, with body parameters already merged in
 * @param spatialHash - the checksum of any normalized shape supplied with the request
 * @returns a request suitable for passing to `computeRequestChecksum`
 */
function request(originalUrl: string, query: object = {}, spatialHash?: string): HarmonyRequest {
  return { originalUrl, query, context: { spatialHash } } as unknown as HarmonyRequest;
}

const rangesetPath = '/C1234-PROV/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset';

describe('request checksums', function () {
  describe('canonicalization', function () {
    it('ignores the order the query parameters were supplied in', function () {
      const a = computeRequestChecksum(request(rangesetPath, { format: 'application/netcdf', maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath, { maxResults: '200', format: 'application/netcdf' }));
      expect(a).to.equal(b);
    });

    it('ignores the letter case of parameter names', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath, { MAXRESULTS: '200' }));
      expect(a).to.equal(b);
    });

    it('ignores trailing slashes on the path', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(`${rangesetPath}/`, { maxResults: '200' }));
      expect(a).to.equal(b);
    });

    it('ignores any query string already present on the url, using the parsed query instead', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(`${rangesetPath}?maxResults=999`, { maxResults: '200' }));
      expect(a).to.equal(b);
    });

    it('ignores the order of repeated values for the same parameter', function () {
      const a = computeRequestChecksum(request(rangesetPath, { subset: ['lat(0:10)', 'lon(20:30)'] }));
      const b = computeRequestChecksum(request(rangesetPath, { subset: ['lon(20:30)', 'lat(0:10)'] }));
      expect(a).to.equal(b);
    });

    it('is versioned, so checksums from a different canonicalization never match', function () {
      expect(computeRequestChecksum(request(rangesetPath))).to.match(/^v1:[0-9a-f]{64}$/);
    });
  });

  describe('parameters that do not affect results', function () {
    it('ignores skipPreview', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath, { maxResults: '200', skipPreview: 'true' }));
      expect(a).to.equal(b);
    });
  });

  describe('parameters that do affect results', function () {
    it('distinguishes requests by label', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath, { maxResults: '200', label: 'foo' }));
      expect(a).to.not.equal(b);
    });

    it('distinguishes requests by path', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath.replace('C1234', 'C5678'), { maxResults: '200' }));
      expect(a).to.not.equal(b);
    });

    it('distinguishes requests by parameter value', function () {
      const a = computeRequestChecksum(request(rangesetPath, { maxResults: '200' }));
      const b = computeRequestChecksum(request(rangesetPath, { maxResults: '201' }));
      expect(a).to.not.equal(b);
    });
  });

  describe('spatial content', function () {
    const edrPath = '/C1234-PROV/ogc-api-edr/1.1.0/collections/all/area';

    it('distinguishes requests whose shapes differ', function () {
      const a = computeRequestChecksum(request(edrPath, {}, 'aaa'));
      const b = computeRequestChecksum(request(edrPath, {}, 'bbb'));
      expect(a).to.not.equal(b);
    });

    it('distinguishes a request with a shape from one without', function () {
      const a = computeRequestChecksum(request(edrPath, {}));
      const b = computeRequestChecksum(request(edrPath, {}, 'aaa'));
      expect(a).to.not.equal(b);
    });

    it('matches the same shape supplied as WKT coords and as an uploaded file', function () {
      const wkt = computeRequestChecksum(request(edrPath, { coords: 'POLYGON((0 0,1 0,1 1,0 0))' }, 'aaa'));
      const uploaded = computeRequestChecksum(request(edrPath, {}, 'aaa'));
      expect(wkt).to.equal(uploaded);
    });

    it('keeps coords in the checksum when it produced no shape', function () {
      const a = computeRequestChecksum(request(edrPath, { coords: 'POINT(0 0)' }));
      const b = computeRequestChecksum(request(edrPath, { coords: 'POINT(1 1)' }));
      expect(a).to.not.equal(b);
    });
  });

  describe('hashGeoJson', function () {
    it('ignores the order keys were assigned in', function () {
      const a = hashGeoJson({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
      const b = hashGeoJson({ coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], type: 'Polygon' });
      expect(a).to.equal(b);
    });

    it('distinguishes shapes whose coordinates differ', function () {
      const a = hashGeoJson({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
      const b = hashGeoJson({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] });
      expect(a).to.not.equal(b);
    });

    it('does not confuse nested array structure with its contents', function () {
      const a = hashGeoJson({ coordinates: [[0, 1]] });
      const b = hashGeoJson({ coordinates: [0, 1] });
      expect(a).to.not.equal(b);
    });
  });
});
