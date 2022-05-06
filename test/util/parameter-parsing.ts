import { describe, it } from 'mocha';
import { expect } from 'chai';
import { ParameterParseError, parseBoolean, parseMultiValueParameter } from '../../app/util/parameter-parsing';

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
});
