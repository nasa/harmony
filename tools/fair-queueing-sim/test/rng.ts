import { expect } from 'chai';
import { describe, it } from 'mocha';

import { hashString, mulberry32, Random, rngFor, standardNormal, uuidFrom } from '../src/rng';

/**
 * Draws n values from a stream.
 *
 * @param random - the stream
 * @param n - how many to draw
 * @returns the values
 */
function draw(random: Random, n: number): number[] {
  return Array.from({ length: n }, () => random());
}

describe('rng', function () {
  describe('hashString', function () {
    it('returns the same 32 bit unsigned integer for the same string', function () {
      const h = hashString('1:job-1:3');
      expect(h).to.equal(hashString('1:job-1:3'));
      expect(Number.isInteger(h)).to.be.true;
      expect(h).to.be.within(0, 0xffffffff);
    });

    it('returns different values for different strings', function () {
      expect(hashString('1:job-1:3')).to.not.equal(hashString('1:job-1:4'));
    });
  });

  describe('mulberry32', function () {
    it('produces the same sequence for the same seed', function () {
      expect(draw(mulberry32(42), 10)).to.deep.equal(draw(mulberry32(42), 10));
    });

    it('produces different sequences for different seeds', function () {
      expect(draw(mulberry32(42), 10)).to.not.deep.equal(draw(mulberry32(43), 10));
    });

    it('produces values in [0, 1)', function () {
      for (const v of draw(mulberry32(7), 10_000)) {
        expect(v).to.be.at.least(0);
        expect(v).to.be.below(1);
      }
    });
  });

  describe('rngFor', function () {
    it('gives the same stream for the same seed and keys', function () {
      expect(draw(rngFor(1, 'job-1', 3), 5)).to.deep.equal(draw(rngFor(1, 'job-1', 3), 5));
    });

    it('gives independent streams for different keys or seeds', function () {
      const base = draw(rngFor(1, 'job-1', 3), 5);
      expect(draw(rngFor(1, 'job-1', 4), 5)).to.not.deep.equal(base);
      expect(draw(rngFor(2, 'job-1', 3), 5)).to.not.deep.equal(base);
    });

    it('is unaffected by draws from other streams', function () {
      const alone = draw(rngFor(1, 'a'), 5);
      const other = rngFor(1, 'b');
      draw(other, 100);
      expect(draw(rngFor(1, 'a'), 5)).to.deep.equal(alone);
    });
  });

  describe('uuidFrom', function () {
    it('returns a well formed version 4 UUID', function () {
      for (let seed = 0; seed < 50; seed++) {
        expect(uuidFrom(mulberry32(seed))).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    });

    it('returns the same UUID for the same stream', function () {
      expect(uuidFrom(rngFor(1, 'job'))).to.equal(uuidFrom(rngFor(1, 'job')));
    });
  });

  describe('standardNormal', function () {
    it('has a mean close to 0 and a standard deviation close to 1', function () {
      const random = mulberry32(123);
      const values = Array.from({ length: 20_000 }, () => standardNormal(random));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      expect(mean).to.be.closeTo(0, 0.03);
      expect(Math.sqrt(variance)).to.be.closeTo(1, 0.03);
    });

    it('stays finite when the stream returns 0', function () {
      expect(Number.isFinite(standardNormal(() => 0))).to.be.true;
    });
  });
});
