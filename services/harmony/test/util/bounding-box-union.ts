import { expect } from 'chai';
import { describe, it } from 'mocha';

import boxStringsToBox, { BoundingBox, boundingRectanglesToBox } from '../../app/util/bounding-box';

/** Convert the same boxes through both public metadata representations. */
function combine(boxes: BoundingBox[], representation: string): BoundingBox {
  if (representation === 'strings') {
    return boxStringsToBox(boxes.map(([w, s, e, n]) => `${s} ${w} ${n} ${e}`));
  }
  return boundingRectanglesToBox(boxes.map(([w, s, e, n]) => ({
    WestBoundingCoordinate: w, SouthBoundingCoordinate: s,
    EastBoundingCoordinate: e, NorthBoundingCoordinate: n,
  })));
}

/** Check a longitude strictly inside a one-degree test cell. */
function contains(box: BoundingBox, longitude: number): boolean {
  return box[0] <= box[2]
    ? longitude >= box[0] && longitude <= box[2]
    : longitude >= box[0] || longitude <= box[2];
}

describe('minimal bounding-box unions', function () {
  const cases: [string, BoundingBox[], BoundingBox][] = [
    ['shorter west expansion', [[170, -10, -170, 10], [150, -20, 160, 20]], [150, -20, -170, 20]],
    ['shorter east expansion', [[170, -10, -170, 10], [-160, -20, -150, 20]], [170, -20, -150, 20]],
    ['western overlap', [[170, -10, -170, 10], [160, -5, 175, 5]], [160, -10, -170, 10]],
    ['contained western interval', [[170, -10, -170, 10], [175, -5, 179, 5]], [170, -10, -170, 10]],
    ['contained eastern interval', [[170, -10, -170, 10], [-179, -5, -175, 5]], [170, -10, -170, 10]],
    ['ordinary overlapping intervals', [[-50, -10, 20, 10], [10, -20, 40, 20]], [-50, -20, 40, 20]],
    ['ordinary disjoint intervals', [[10, -10, 20, 10], [30, -20, 40, 20]], [10, -20, 40, 20]],
    ['opposite sides of antimeridian', [[-179, -10, -170, 10], [170, -20, 179, 20]], [170, -20, -170, 20]],
    ['two crossing intervals', [[170, -10, -160, 10], [160, -20, -170, 20]], [160, -20, -160, 20]],
    ['full-world coverage', [[170, -10, -170, 10], [-175, -20, 175, 20]], [-180, -20, 180, 20]],
    ['explicit full-world box', [[-180, -10, 180, 10], [10, -20, 20, 20]], [-180, -20, 180, 20]],
    ['touching intervals', [[-180, -10, 0, 10], [0, -20, 180, 20]], [-180, -20, 180, 20]],
    ['fractional coordinates', [[170.5, -10.5, -169.5, 10.5], [150.5, -20.5, 160.5, 20.5]], [150.5, -20.5, -169.5, 20.5]],
    ['three-interval minimal arc', [[-160, -10, -150, 10], [0, -20, 10, 20], [150, -5, 160, 5]], [0, -20, -150, 20]],
    ['point intervals', [[170, -10, 170, 10], [-170, -20, -170, 20]], [170, -20, -170, 20]],
  ];

  for (const representation of ['strings', 'rectangles']) {
    for (const [name, boxes, expected] of cases) {
      it(`${representation}: ${name} in either input order`, function () {
        const before = JSON.stringify(boxes);
        expect(combine(boxes, representation)).to.eql(expected);
        expect(combine([...boxes].reverse(), representation)).to.eql(expected);
        expect(JSON.stringify(boxes)).to.equal(before);
      });
    }

    it(`${representation}: retains gaps until all three boxes have been considered`, function () {
      const boxes: BoundingBox[] = [[100, -35, -100, 35], [11, 10, 17.4, 15.1], [-90, -40.1, 10.4, 30.2]];
      for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
        expect(combine(order.map((index) => boxes[index]), representation)).to.eql([100, -40.1, 17.4, 35]);
      }
    });

    it(`${representation}: matches an independent one-degree coverage oracle`, function () {
      let state = 1729;
      const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
      };
      for (let trial = 0; trial < 100; trial++) {
        const boxes: BoundingBox[] = [];
        const count = 2 + next() % 3;
        for (let index = 0; index < count; index++) {
          const west = next() % 360 - 180;
          let east = next() % 360 - 180;
          if (east === west) east = east === 179 ? -180 : east + 1;
          boxes.push([west, -10, east, 10]);
        }
        const covered = Array.from({ length: 360 }, (_, index) =>
          boxes.some((box) => contains(box, index - 179.5)));
        let longestGap = 0;
        let currentGap = 0;
        for (let index = 0; index < 720; index++) {
          currentGap = covered[index % 360] ? 0 : currentGap + 1;
          longestGap = Math.max(longestGap, currentGap);
        }
        const result = combine(boxes, representation);
        const width = result[0] <= result[2] ? result[2] - result[0] : 360 + result[2] - result[0];
        expect(width, JSON.stringify(boxes)).to.equal(360 - longestGap);
        expect(covered.every((cell, index) => !cell || contains(result, index - 179.5))).to.equal(true);
      }
    });
  }
});
