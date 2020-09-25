import { describe, it } from 'mocha';
import { expect } from 'chai';
import parseMultiValueParameter from '../../app/util/parameter-parsing';

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
});
