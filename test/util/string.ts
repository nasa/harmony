import { describe, it } from 'mocha';
import { expect } from 'chai';
import { listToText, truncateString, Conjunction, isInteger, inEcr, sanitizeImage } from '../../app/util/string';

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

    it('returns the items separated by " and " when receiving two items and no conjuction specified', function () {
      expect(listToText(['a', 'b'])).to.equal('a and b');
    });

    it('returns the items separated by " and " when receiving two items and provided "and" as the conjuction to use', function () {
      expect(listToText(['a', 'b'], Conjunction.AND)).to.equal('a and b');
    });

    it('returns the items separated by " or " when provided "or" as the conjuction to use', function () {
      expect(listToText(['a', 'b'], Conjunction.OR)).to.equal('a or b');
    });

    it('returns the items as a textual list when receiving more than two items', function () {
      expect(listToText(['a', 'b', 'c'])).to.equal('a, b, and c');
      expect(listToText(['a', 'b', 'c', 'd'], Conjunction.OR)).to.equal('a, b, c, or d');
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

  describe('#isInteger', function () {
    it('returns true for 0', function () {
      expect(isInteger('0')).to.be.true;
    });
    it('returns true for -15', function () {
      expect(isInteger('-15')).to.be.true;
    });
    it('returns false for -1.5', function () {
      expect(isInteger('-1.5')).to.be.false;
    });
    it('returns false for 1.5', function () {
      expect(isInteger('1.5')).to.be.false;
    });
    it('returns false for 31115.foo.bar', function () {
      expect(isInteger('31115.foo.bar')).to.be.false;
    });
  });

  describe('#inEcr', function () {
    it('returns false if the image is not in ECR', function () {
      expect(inEcr('00000000.xyz.abc.REGION-5.googlecloud.com/')).to.be.false;
    });
    it('returns true if the image is in ECR', function () {
      expect(inEcr('00000000.xyz.abc.REGION-5.amazonaws.com/')).to.be.true;
    });
  });

  describe('#sanitizeImage', function () {
    it('strips aws account information from image url', function () {
      expect(sanitizeImage('00000000.xyz.abc.REGION-5.amazonaws.com/the-image-name')).to.equal('the-image-name');
    });
    it('strips ghcr account information from image url', function () {
      expect(sanitizeImage('ghcr.io/x/y:1.0.0')).to.equal('x/y:1.0.0');
    });
    it('strips private earthdata location from image url', function () {
      expect(sanitizeImage('private.earthdata.nasa.gov/the-image-name')).to.equal('the-image-name');
    });
  });
});
