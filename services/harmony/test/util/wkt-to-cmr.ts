import { expect } from 'chai';
import { describe, it } from 'mocha';
import { wktToCmrQueryParams } from '../../app/util/wkt-to-cmr';

describe('#wktToCmrQueryParams', function () {
  describe('using a POINT', function () {
    it('returns a CMR point query', function () {
      const wkt = 'POINT(0.00577 51.562608)';
      expect(wktToCmrQueryParams(wkt)).to.eql({ 'point': '0.00577,51.562608' });
    });
  });

  describe('using a POLYGON', function () {
    it('returns a CMR polygon query', function () {
      const wkt = 'POLYGON((-0.898132 51.179362,-0.909119 51.815488,0.552063 51.818884,0.560303 51.191414,-0.898132 51.179362))';
      const expectedCmrPolygon = '-0.898132,51.179362,-0.909119,51.815488,0.552063,51.818884,0.560303,51.191414,-0.898132,51.179362';
      expect(wktToCmrQueryParams(wkt)).to.eql({ 'polygon[]': expectedCmrPolygon });
    });
  });

  describe('using a LINESTRING', function () {
    it('returns a CMR line query', function () {
      const wkt = 'LINESTRING(-3.56 53.695,-3.546 53.696,-3.532 53.697)';
      expect(wktToCmrQueryParams(wkt)).to.eql({ 'line[]': '-3.56,53.695,-3.546,53.696,-3.532,53.697' });
    });
  });
});

