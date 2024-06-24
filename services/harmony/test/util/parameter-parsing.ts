import { describe, it } from 'mocha';
import { expect } from 'chai';
import { ParameterParseError, parseBoolean, parseMultiValueParameter, parseNumber, parseWkt } from '../../app/util/parameter-parsing-helpers';

describe('util/parameter-parsing', function () {
  describe('#parseMultiValueParameter', function () {
    it('returns an array unchanged when it receives an array', function () {
      expect(parseMultiValueParameter(['foo', 'bar'])).to.eql(['foo', 'bar']);
    });

    it('returns an array of values when provided a comma-separated string', function () {
      expect(parseMultiValueParameter('C1-PROV1,C2-PROV2')).to.eql(['C1-PROV1', 'C2-PROV2']);
    });

    it('ignores leading and trailing whitespace between comma-separated values', function () {
      expect(parseMultiValueParameter(' C1-PROV1 ,   C2-PROV2  ')).to.eql(['C1-PROV1', 'C2-PROV2']);
    });

    it('can parse a string with more than 3 comma-separated values', function () {
      expect(parseMultiValueParameter('C1-PROV1,C2-PROV2,C3-PROV1,C4-PROVIDER3'))
        .to.eql(['C1-PROV1', 'C2-PROV2', 'C3-PROV1', 'C4-PROVIDER3']);
    });
  });

  describe('#parseBoolean', function () {
    it('returns true for "true"', function () {
      expect(parseBoolean('true')).to.be.true;
    });

    it('returns true for "TRUE"', function () {
      expect(parseBoolean('TRUE')).to.be.true;
    });

    it('returns false for "false"', function () {
      expect(parseBoolean('false')).to.be.false;
    });

    it('returns false for "FALSE"', function () {
      expect(parseBoolean('FALSE')).to.be.false;
    });

    it('returns false for "FaLsE"', function () {
      expect(parseBoolean('FaLsE')).to.be.false;
    });

    it('returns true for "tRUe"', function () {
      expect(parseBoolean('tRUe')).to.be.true;
    });

    it('returns false for null ', function () {
      expect(parseBoolean(null)).to.be.false;
    });

    it('returns false for undefined ', function () {
      expect(parseBoolean(undefined)).to.be.false;
    });

    it('throws a parse error for "truthy"', function () {
      expect(() => parseBoolean('truthy')).to.throw(ParameterParseError, '\'truthy\' must be \'false\' or \'true\'');
    });
  });

  describe('#parseNumber', function () {
    it('returns 123 for "123"', function () {
      expect(parseNumber('123')).to.equal(123);
    });

    it('returns 123 for 123', function () {
      expect(parseNumber(123)).to.equal(123);
    });

    it('returns 123.45 for "123.45"', function () {
      expect(parseNumber('123.45')).to.equal(123.45);
    });

    it('returns 123.45 for 123.45', function () {
      expect(parseNumber(123.45)).to.equal(123.45);
    });

    it('throws a parse error for "abc"', function () {
      expect(() => parseNumber('abc')).to.throw(ParameterParseError, '\'abc\' must be a number.');
    });
  });

  describe('#parseWkt', () => {
    it('should parse a valid Polygon WKT string', () => {
      const wkt = 'POLYGON((10 10, 20 20, 30 10, 10 10))';
      const result = parseWkt(wkt);
      const expected = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'geometry': {
              type: 'Polygon',
              coordinates: [[[10, 10], [20, 20], [30, 10], [10, 10]]],
            },
            'properties': {},
          },
        ],
      };
      expect(result).to.deep.equal(expected);
    });

    it('should parse a Polygon WKT string with a hole', () => {
      const wkt = 'POLYGON((0 0, 50 0, 50 50, 0 50, 0 0), (10 10, 40 10, 40 40, 10 40, 10 10))';
      const result = parseWkt(wkt);
      const expected = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'geometry': {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0], [50, 0], [50, 50], [0, 50], [0, 0],
                ],
                [
                  [10, 10], [40, 10], [40, 40], [10, 40], [10, 10],
                ],
              ],
            },
            'properties': {},
          },
        ],
      };
      expect(result).to.deep.equal(expected);
    });

    it('should parse a valid MultiPolygon WKT string', () => {
      const wkt = 'MULTIPOLYGON(((10 10, 20 20, 30 10, 10 10)),((40 40, 50 50, 60 40, 40 40)))';
      const result = parseWkt(wkt);
      const expected = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'geometry': {
              type: 'MultiPolygon',
              coordinates: [
                [[[10, 10], [20, 20], [30, 10], [10, 10]]],
                [[[40, 40], [50, 50], [60, 40], [40, 40]]],
              ],
            },
            'properties': {},
          },
        ],
      };
      expect(result).to.deep.equal(expected);
    });

    it('should parse a MultiPolygon WKT string with holes', () => {
      const wkt = 'MULTIPOLYGON(((40 40, 70 40, 70 70, 40 70, 40 40), (50 50, 60 50, 60 60, 50 60, 50 50)), ((100 100, 130 100, 130 130, 100 130, 100 100)))';
      const result = parseWkt(wkt);
      const expected = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'geometry': {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [[40, 40], [70, 40], [70, 70], [40, 70], [40, 40]],
                  [[50, 50], [60, 50], [60, 60], [50, 60], [50, 50]],
                ],
                [
                  [[100, 100], [130, 100], [130, 130], [100, 130], [100, 100]],
                ],
              ],
            },
            'properties': {},
          },
        ],
      };
      expect(result).to.deep.equal(expected);
    });

    // TODO - we will support LineString with HARMONY-XXXX
    it('should throw an error for unsupported WKT types like LineString', () => {
      const wkt = 'LINESTRING(10 10, 20 20, 30 40)';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unsupported WKT type LineString.');
    });

    // TODO - we will support Point with HARMONY-XXXX
    it('should throw an error for unsupported WKT types like Point', () => {
      const wkt = 'POINT(10 20)';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unsupported WKT type Point.');
    });

    // TODO - we will support MultiPoint with HARMONY-XXXX
    it('should throw an error for unsupported WKT types like MultiPoint', () => {
      const wkt = 'MULTIPOINT((10 40), (40 30), (20 20), (30 10))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unsupported WKT type MultiPoint.');
    });

    // TODO - we will support MultiLine with HARMONY-XXXX
    it('should throw an error for unsupported WKT types like MultiLineString', () => {
      const wkt = 'MULTILINESTRING((10 10, 20 20), (15 15, 40 40))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unsupported WKT type MultiLineString.');
    });

    it('should throw an error for unsupported WKT types like GeometryCollection', () => {
      const wkt = 'GEOMETRYCOLLECTION(POINT(4 6), LINESTRING(4 6,7 10))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unsupported WKT type GeometryCollection.');
    });

    it('should throw an error for unsupported WKT types like CircularString', () => {
      const wkt = 'CIRCULARSTRING(0 0, 1 1, 1 0)';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unable to parse WKT string CIRCULARSTRING(0 0, 1 1, 1 0).');
    });

    it('should throw an error for unsupported WKT types like CompoundCurve', () => {
      const wkt = 'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 1 0), (1 0, 0 1))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 1 0), (1 0, 0 1)).');
    });

    it('should throw an error for unsupported WKT types like PolyhedralSurface', () => {
      const wkt = 'POLYHEDRALSURFACE(((0 0 1, 0 1 0, 1 0 0, 0 0 1)))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unable to parse WKT string POLYHEDRALSURFACE(((0 0 1, 0 1 0, 1 0 0, 0 0 1))).');
    });

    it('should throw an error for unsupported WKT types like TIN', () => {
      const wkt = 'TIN(((0 0, 1 0, 0 1, 0 0)))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unable to parse WKT string TIN(((0 0, 1 0, 0 1, 0 0))).');
    });

    it('should throw an error for unparseable WKT strings', () => {
      const wkt = 'POLYGON((((10 10, 20 20, 30 30, 10 10))';
      expect(() => parseWkt(wkt)).to.throw(ParameterParseError, 'Unable to parse WKT string POLYGON((((10 10, 20 20, 30 30, 10 10)).');
    });
  });

});
