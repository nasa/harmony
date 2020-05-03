import { describe, it } from 'mocha';
import { expect } from 'chai';
import { wrap } from '../../app/util/array';

describe('util/array', function () {
  describe('wrap', function () {
    it('returns an array containing a single value when passed a non-array value', function () {
      expect(wrap('value')).to.eql(['value']);
    });

    it('returns the original array when passed an array value', function () {
      // Note: reference equality
      const input = ['value'];
      expect(wrap(input)).to.eq(input);
    });

    it('returns the original array when passed an array of arrays', function () {
      // Note: reference equality
      const input = [['value1'], ['value2']];
      expect(wrap(input)).to.eq(input);
    });

    it('returns an empty array when passed null', function () {
      expect(wrap(null)).to.eql([]);
    });

    it('returns an empty array when passed undefined', function () {
      expect(wrap(undefined)).to.eql([]);
    });

    it('returns an empty array when passed an empty string', function () {
      expect(wrap('')).to.eql([]);
    });

    it('returns an array containing false when passed false', function () {
      expect(wrap(false)).to.eql([false]);
    });

    it('returns an array containing 0 when passed 0', function () {
      expect(wrap(0)).to.eql([0]);
    });
  });
});
