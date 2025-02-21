import { expect } from 'chai';
import { describe, it } from 'mocha';

import { validateCrontab } from '../app/util/cron-validation';

// Not going to test every possible valid/invalid string here, just a few to make
// sure things generally work
describe('Crontab validation', function () {
  describe('when a crontab entry is valid', function () {
    it('does not return an error', function () {
      expect(validateCrontab('5 * * * *')).to.be.null;
    });
  });

  describe('when a valid crontab entry contains a seconds field', function () {
    it('does not return an error', function () {
      expect(validateCrontab('30 * * * * *')).to.be.null;
    });
  });


  describe('when a crontab entry contains a valid nickname', function () {
    it('does not return an error', function () {
      expect(validateCrontab('@hourly')).to.be.null;
    });
  });

  describe('when a crontab entry contains too many entries', function () {
    it('returns an error', function () {
      expect(validateCrontab('*/5 * * * * * *')).to.eql("CronPattern: invalid configuration format ('*/5 * * * * * *'), exactly five or six space separated parts are required.");
    });
  });
});