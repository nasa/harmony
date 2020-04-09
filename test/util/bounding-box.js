const { describe, it } = require('mocha');
const { expect } = require('chai');
const boxStringsToBox = require('../../app/util/bounding-box');

describe('util/bounding-box', function () {
  describe('boxStringsToBox', function () {
    // inputs are in SWNE order

    it('returns the ordinates in WSEN order', function () {
      const input = ['-35.0 -100.0 35.0 100.0'];
      expect(boxStringsToBox(input)).to.eql([-100.0, -35.0, 100.0, 35.0]);
    });
  });

  describe('when given more than one box', function () {
    it('returns a single box that covers all', function () {
      const input = [
        '-35.0 -100.0 35.0 10.0',
        '10.0 11.0 15.1 17.4',
        '-40.1 -90, 30.2 10.4',
      ];
      expect(boxStringsToBox(input)).to.eql([-100, -40.1, 17.4, 35.0]);
    });

    it('handles boxes that cross the antimeridian', function () {
      const input = [
        '-35.0 100.0 35.0 -100.0', // crosses AM
        '10.0 11.0 15.1 17.4',
        '-40.1 -90, 30.2 10.4',
      ];
      expect(boxStringsToBox(input)).to.eql([100, -40.1, 17.4, 35]);
    });
  });

  describe('when given an empty input', function () {
    it('returns an empty array', function () {
      const input = [];
      expect(boxStringsToBox(input)).to.eql([]);
    });
  });
});
