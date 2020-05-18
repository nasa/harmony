import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  parseSubsetParams,
  subsetParamsToBbox,
  subsetParamsToTemporal,
  ParameterParseError,
} from 'frontends/ogc-coverages/util/parameter-parsing';

describe('OGC API Coverages - Utilities', function () {
  describe('parseSubsetParams', function () {
    // Function that returns a function that calls parseSubsetParams with the given value,
    // necessary for setting mocha expectations about exceptions.
    const parseSubsetParamsFn = (value) => (): object => parseSubsetParams(value);

    describe('lat subsets', function () {
      it('returns a parsed object with "lat" info when passed a valid range', function () {
        expect(parseSubsetParams(['lat(-10:10.5)'])).to.eql({ lat: { min: -10, max: 10.5 } });
      });

      it('returns a parsed object with max value 90 when the range max is "*"', function () {
        expect(parseSubsetParams(['lat(-10:*)'])).to.eql({ lat: { min: -10, max: 90 } });
      });

      it('returns a parsed object with min value -90 when the range min is "*"', function () {
        expect(parseSubsetParams(['lat(*:10.5)'])).to.eql({ lat: { min: -90, max: 10.5 } });
      });

      it('throws a parse error when passed a range that is not numeric', function () {
        expect(parseSubsetParamsFn(['lat(abc:10.5)'])).to.throw(ParameterParseError, 'subset dimension "lat" has an invalid numeric value "abc"');
      });

      it('throws a parse error when passed a range that is partially blank', function () {
        expect(parseSubsetParamsFn(['lat(:10.5)'])).to.throw(ParameterParseError, 'could not be parsed');
      });

      it('throws a parse error when passed a range that has invalid syntax', function () {
        expect(parseSubsetParamsFn(['lat(-10)'])).to.throw(ParameterParseError, 'could not be parsed');
      });

      it('throws a parse error when the range minimum is higher than the maximum', function () {
        expect(parseSubsetParamsFn(['lat(10.5:-10)'])).to.throw(ParameterParseError, 'subset dimension "lat" values must be ordered from low to high');
      });

      it('throws a parse error when the range minimum is lower than -90', function () {
        expect(parseSubsetParamsFn(['lat(-90.1:10)'])).to.throw(ParameterParseError, 'subset dimension "lat" values must be greater than -90');
      });

      it('throws a parse error when the range maximum is greater than 90', function () {
        expect(parseSubsetParamsFn(['lat(-10:90.1)'])).to.throw(ParameterParseError, 'subset dimension "lat" values must be less than 90');
      });
    });

    describe('lon subsets', function () {
      it('returns a parsed object with "lon" info when passed a valid range', function () {
        expect(parseSubsetParams(['lon(-10:10.5)'])).to.eql({ lon: { min: -10, max: 10.5 } });
      });

      it('returns a parsed object with max value 180 when the range max is "*"', function () {
        expect(parseSubsetParams(['lon(-10:*)'])).to.eql({ lon: { min: -10, max: 180 } });
      });

      it('returns a parsed object with min value -180 when the range min is "*"', function () {
        expect(parseSubsetParams(['lon(*:10.5)'])).to.eql({ lon: { min: -180, max: 10.5 } });
      });

      it('returns a parsed object with "lon" info when the range minimum is higher than the maximum', function () {
        expect(parseSubsetParams(['lon(10:-10.5)'])).to.eql({ lon: { min: 10, max: -10.5 } });
      });

      it('throws a parse error when passed a range that is not numeric', function () {
        expect(parseSubsetParamsFn(['lon(abc:10.5)'])).to.throw(ParameterParseError, 'subset dimension "lon" has an invalid numeric value "abc"');
      });

      it('throws a parse error when passed a range that is partially blank', function () {
        expect(parseSubsetParamsFn(['lon(:10.5)'])).to.throw(ParameterParseError, 'could not be parsed');
      });

      it('throws a parse error when passed a range that has invalid syntax', function () {
        expect(parseSubsetParamsFn(['lon(-10)'])).to.throw(ParameterParseError, 'could not be parsed');
      });

      it('throws a parse error when the range minimum is lower than -180', function () {
        expect(parseSubsetParamsFn(['lon(-180.1:10)'])).to.throw(ParameterParseError, 'subset dimension "lon" values must be greater than -180');
      });

      it('throws a parse error when the range minimum is higher than 180', function () {
        expect(parseSubsetParamsFn(['lon(180.1:10)'])).to.throw(ParameterParseError, 'subset dimension "lon" values must be less than 180');
      });

      it('throws a parse error when the range maximum is lower than -180', function () {
        expect(parseSubsetParamsFn(['lon(-10:-180.1)'])).to.throw(ParameterParseError, 'subset dimension "lon" values must be greater than -180');
      });

      it('throws a parse error when the range maximum is higher than 180', function () {
        expect(parseSubsetParamsFn(['lon(-10:180.1)'])).to.throw(ParameterParseError, 'subset dimension "lon" values must be less than 180');
      });
    });

    describe('time subsets', function () {
      it('returns a parsed object with "time" info when passed a valid range', function () {
        expect(parseSubsetParams(['time("2001-05-01T12:35:00Z":"2002-07-01T13:18:55Z")'])).to.eql({
          time: { min: new Date('2001-05-01T12:35:00Z'), max: new Date('2002-07-01T13:18:55Z') } });
      });

      it('returns a parsed object with an unbounded end when the ending range is "*"', function () {
        expect(parseSubsetParams(['time("2001-05-01T12:35:00Z":*)'])).to.eql({
          time: { min: new Date('2001-05-01T12:35:00Z'), max: undefined } });
      });

      it('returns a parsed object with an unbounded start when the starting range is "*"', function () {
        expect(parseSubsetParams(['time(*:"2001-05-01T12:35:00Z")'])).to.eql({
          time: { min: undefined, max: new Date('2001-05-01T12:35:00Z') } });
      });

      it('returns a parsed object with an unbounded start and unbounded end time when both ranges are "*"', function () {
        expect(parseSubsetParams(['time(*:*)'])).to.eql({
          time: { min: undefined, max: undefined } });
      });

      it('returns a parsed object with an unbounded start and unbounded end time when just a single "*" is provided', function () {
        expect(parseSubsetParams(['time(*)'])).to.eql({
          time: { min: undefined, max: undefined } });
      });

      it('returns a parsed object with the same start and end when only a single date time value is provided', function () {
        expect(parseSubsetParams(['time("2001-05-01T12:35:00Z")'])).to.eql({
          time: { min: new Date('2001-05-01T12:35:00Z'), max: new Date('2001-05-01T12:35:00Z') } });
      });

      it('throws a parse error when the starting time is later than the ending time', function () {
        expect(parseSubsetParamsFn(['time("2002-07-01T13:18:55Z":"2001-05-01T12:35:00Z")'])).to.throw(ParameterParseError, 'subset dimension "time" values must be ordered from low to high');
      });

      it('throws a parse error when the starting time is not a valid date time', function () {
        expect(parseSubsetParamsFn(['time("abc":"2001-05-01T12:35:00Z")'])).to.throw(ParameterParseError, 'subset dimension "time" has an invalid date time "abc"');
      });

      it('throws a parse error when the end time is not a valid date time', function () {
        expect(parseSubsetParamsFn(['time("2001-05-01T12:35:00Z":"xyz")'])).to.throw(ParameterParseError, 'subset dimension "time" has an invalid date time "xyz"');
      });

      it('throws a parse error when missing the ":" range separator value', function () {
        expect(parseSubsetParamsFn(['time("2001-05-01T12:35:00Z""2002-07-01T13:18:55Z")'])).to.throw(ParameterParseError, 'subset dimension "time" has an invalid date time "2001-05-01T12:35:00Z""2002-07-01T13:18:55Z"');
      });

      it('throws a parse error when the ending range is missing', function () {
        expect(parseSubsetParamsFn(['time("2001-05-01T12:35:00Z":)'])).to.throw(ParameterParseError, 'subset dimension "time" could not be parsed');
      });

      it('throws a parse error when the starting range is missing', function () {
        expect(parseSubsetParamsFn(['time(:"2001-05-01T12:35:00Z")'])).to.throw(ParameterParseError, 'subset dimension "time" could not be parsed');
      });
    });

    describe('multiple subsets', function () {
      it('returns a parsed object with "lat" and "lon" info when passed a valid ranges', function () {
        expect(parseSubsetParams(['lon(-10:10.5)', 'lat(-20:20.5)', 'time("2001-05-01T12:35:00Z":"2002-07-01T13:18:55Z")'])).to.eql({
          lon: { min: -10, max: 10.5 },
          lat: { min: -20, max: 20.5 },
          time: { min: new Date('2001-05-01T12:35:00Z'), max: new Date('2002-07-01T13:18:55Z') },
        });
      });

      it('throws a parse error when passed duplicate ranges', function () {
        expect(parseSubsetParamsFn(['lon(-10:10.5)', 'lon(-10.5:9)'])).to.throw(ParameterParseError, 'dimension "lon" was specified multiple times');
      });
    });

    describe('subsets of unrecognized dimensions', function () {
      it('throws a parse error when provided an unrecognized dimension', function () {
        expect(parseSubsetParamsFn(['long(-10:10.5)'])).to.throw(ParameterParseError, 'unrecognized subset dimension "long"');
      });
    });
  });

  describe('subsetParamsToBbox', function () {
    it('returns a bounding box containing the parsed dimensions when passed both lat and lon dimensions', function () {
      expect(subsetParamsToBbox({
        lat: { min: -10, max: 10.5 },
        lon: { min: -20, max: 20.5 },
      })).to.eql([-20, -10, 20.5, 10.5]);
    });

    it('returns a bounding box containing the parsed lat and full lon coverage when passed only a lat dimension', function () {
      expect(subsetParamsToBbox({
        lat: { min: -10, max: 10.5 },
      })).to.eql([-180, -10, 180, 10.5]);
    });

    it('returns a bounding box containing the parsed lon and full lat coverage when passed only a lon dimension', function () {
      expect(subsetParamsToBbox({
        lon: { min: -10, max: 10.5 },
      })).to.eql([-10, -90, 10.5, 90]);
    });

    it('returns null when passed neither lat nor lon dimensions', function () {
      expect(subsetParamsToBbox({})).to.eql(null);
    });

    it('returns a bounding box containing the parsed lat and lon dimensions when passed extra dimensions', function () {
      expect(subsetParamsToBbox({
        lat: { min: -10, max: 10.5 },
        lon: { min: -20, max: 20.5 },
        time: { min: undefined, max: new Date('2001-05-01T12:35:00Z') },
      })).to.eql([-20, -10, 20.5, 10.5]);
    });
  });

  describe('subsetParamsToTemporal', function () {
    it('returns temporal information with startTime and stopTime when passed both a min and max', function () {
      expect(subsetParamsToTemporal({
        time: { min: new Date('2001-05-01T12:35:00Z'), max: new Date('2002-07-01T13:18:55Z') },
      })).to.eql({ startTime: new Date('2001-05-01T12:35:00Z'), stopTime: new Date('2002-07-01T13:18:55Z') });
    });

    it('returns temporal information without a startTime when passed only a max', function () {
      expect(subsetParamsToTemporal({
        time: { min: undefined, max: new Date('2002-07-01T13:18:55Z') },
      })).to.eql({ stopTime: new Date('2002-07-01T13:18:55Z') });
    });

    it('returns temporal information without a stopTime when passed only a min', function () {
      expect(subsetParamsToTemporal({
        time: { min: new Date('2001-05-01T12:35:00Z'), max: undefined },
      })).to.eql({ startTime: new Date('2001-05-01T12:35:00Z') });
    });

    it('returns an empty object when both min and max are undefined', function () {
      expect(subsetParamsToTemporal({
        time: { min: undefined, max: undefined },
      })).to.eql({});
    });

    it('returns temporal information with startTime and stopTime when passed extra dimensions', function () {
      expect(subsetParamsToTemporal({
        lat: { min: -10, max: 10.5 },
        lon: { min: -20, max: 20.5 },
        time: { min: new Date('2001-05-01T12:35:00Z'), max: new Date('2002-07-01T13:18:55Z') },
      })).to.eql({ startTime: new Date('2001-05-01T12:35:00Z'), stopTime: new Date('2002-07-01T13:18:55Z') });
    });
  });
});
