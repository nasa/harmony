import { expect } from 'chai';
import { describe, it } from 'mocha';

import { validateTimeInterval } from '../app/util/time-interval-validation';

// Not going to test every possible valid/invalid string here, just a few to make
// sure things generally work
describe('Time interval validation', function () {
  describe('when a time interv al entry is valid', function () {
    it('does not return an error', function () {
      expect(validateTimeInterval('1 HOUR')).to.be.null;
    });
  });

  describe('when a valid time interval entry contains a plural unit', function () {
    it('does not return an error', function () {
      expect(validateTimeInterval('10 MINUTES')).to.be.null;
    });
  });

  describe('when a time interval entry contains too many entries', function () {
    it('returns an error', function () {
      expect(validateTimeInterval('1 HOUR 10 MINUTES')).to.eql('Only one time interval may be specified.');
    });
  });
});