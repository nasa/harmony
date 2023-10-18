import { describe, it } from 'mocha';
import { expect } from 'chai';
import { keysToLowerCase } from '../../app/util/object';

describe('util/object', function () {
  describe('#keysToLowerCase', function () {
    it('returns null when receiving null instead of an object', function () {
      expect(keysToLowerCase(null)).to.equal(null);
    });

    it('lowercases all keys', function () {
      expect(keysToLowerCase({ ALPHA: 'omega', foo: 'bar', camelCase: 42 })).to.eql({ alpha: 'omega', foo: 'bar', camelcase: 42 });
    });

    it('makes no change to numbers', function () {
      expect(keysToLowerCase({ 123: 'value' })).to.eql({ 123: 'value' });
    });

    it('makes no change to dashes or underscores', function () {
      expect(keysToLowerCase({ snake_case: 1, SCREAMING_SNAKE_CASE: 2, 'dash-case': 3, 'SCREAMING-DASH-CASE': 4 }))
        .to.eql({ snake_case: 1, screaming_snake_case: 2, 'dash-case': 3, 'screaming-dash-case': 4 });
    });
  });
});
