const { describe, it } = require('mocha');
const { expect } = require('chai');
const { listToText } = require('../../app/util/string');

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
});
