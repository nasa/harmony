import { describe, it } from 'mocha';
import { expect } from 'chai';
import { ParameterParseError, parseBoolean, parseMultiValueParameter, parseNumber } from '../../app/util/parameter-parsing-helpers';

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

    // Function that returns a function that calls parseBoolean with the given value,
    // necessary for setting mocha expectations about exceptions.
    const parseBooleanFn = (value) => (): boolean => parseBoolean(value);
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
      expect(parseBooleanFn('truthy')).to.throw(ParameterParseError, '\'truthy\' must be \'false\' or \'true\'');
    });
  });

  describe('#parseNumber', function () {

    // Function that returns a function that calls parseNumber with the given value,
    // necesssary for setting mocha expectations about exceptions.
    // Copied from parseBolean tests.
    const parseNumberFn = (value) => (): number => parseNumber(value);

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
      expect(parseNumberFn('abc')).to.throw(ParameterParseError, '\'abc\' must be a number.');
    });
  });
});
