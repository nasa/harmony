import { describe, it } from 'mocha';
import { expect } from 'chai';
import { listToText, truncateString } from '../../app/util/string';

describe('util/string', function () {
  describe('#listToText', function () {
    it('returns an empty string when called with null', function () {
      expect(listToText(null)).to.equal('');
    });

    it('returns an empty string when receiving an empty array', function () {
      expect(listToText([])).to.equal('');
    });

    it('returns the item when receiving an array with a single item', function () {
      expect(listToText(['a'])).to.equal('a');
    });

    it('returns the items separated by " and " when receiving two items', function () {
      expect(listToText(['a', 'b'])).to.equal('a and b');
    });

    it('returns the items as a textual list when receiving more than two items', function () {
      expect(listToText(['a', 'b', 'c'])).to.equal('a, b, and c');
      expect(listToText(['a', 'b', 'c', 'd'])).to.equal('a, b, c, and d');
    });
  });

  describe('#truncateString', function () {
    describe('when provided a string shorter than the max', function () {
      const s = 'short';
      const n = 6;
      it('returns the original string', function () {
        expect(truncateString(s, n)).to.equal('short');
      });
    });

    describe('when provided a string with the same number of characters as the max allowed', function () {
      const s = 'just right';
      const n = 10;
      it('returns the original string', function () {
        expect(truncateString(s, n)).to.equal('just right');
      });
    });

    describe('when provided a string greater than the max', function () {
      const s = 'too long';
      const n = 6;
      it('returns the string with up to the max number of characters with the last three characters being ...', function () {
        expect(truncateString(s, n)).to.equal('too...');
      });
    });

    describe('when provided a number of chars less than 3', function () {
      const s = 'too long';
      const n = 1;
      it('returns just ...', function () {
        expect(truncateString(s, n)).to.equal('...');
      });
    });
  });
});
