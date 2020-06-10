import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Spatial, computeMbr } from '../../../app/util/spatial/mbr';

/**
 * Makes a Spatial object from a lat/lng string
 * @param points - latitude and longitude in the form 'lat lng'
 * @returns a Spatial object containing a 'points' entry
 */
function makePointsSpatial(points: string[]): Spatial {
  return { points };
}


/**
 * Makes lines
 * @param points - line string in the form 'lat lng lat lng ...'
 * @returns a Spatial object containing a 'lines' entry
 */
function makeLinesSpatial(points: string[]): Spatial {
  return { lines: points };
}

/**
 * Makes polygon
 * @param polygon - the polygons
 * @returns a Spatial object with a `polygons` entry
 */
function makePolygonsSpatial(polygons: string[][]): Spatial {
  return { polygons };
}

describe('Given a point', () => {
  const tests: [string, string[], number[]][] = [
    [
      'a simple point',
      ['10 35'],
      [34.99999999, 9.99999999, 35.00000001, 10.00000001],
    ],
    [
      'a point on the antimeridian',
      ['0, 180'],
      [179.99999999, -1e-8, -179.99999999, 1e-8],
    ],
    [
      'a point on a pole',
      ['90 0'],
      [-1e-8, 89.99999999, 1e-8, 89.99999999],
    ],
    [
      'more than one point',
      ['10 35', '20 40'],
      [34.99999999, 9.99999999, 40.00000001, 20.00000001],
    ],
  ];

  tests.forEach((test) => {
    describe(`when the point is ${test[0]}`, function () {
      it('returns a correct mbr', function () {
        expect(computeMbr(makePointsSpatial(test[1]))).to.eql(test[2]);
      });
    });
  });
});

describe('Given a line', () => {
  const tests: [string, string[], number[]][] = [
    [
      'a simple line',
      ['10 35 15 45 25 45'],
      [35, 10, 45, 25],
    ],
    [
      'a line across the antimeridian',
      ['-10, 170 10 -170'],
      [170, -10, -170, 10],
    ],
    [
      'a line near a pole',
      ['85 0 89 10'],
      [0, 85, 10, 89],
    ],
    [
      'more than one line',
      ['10 35 15 45', '20 40 25 30'],
      [30, 10, 45, 25],
    ],
    [
      'more than one line on either side of the antimeridian',
      ['10 170 15 175', '20 -170 25 -175'],
      [170, 10, -170, 25],
    ],
  ];

  tests.forEach((test) => {
    describe(`when the line is ${test[0]}`, function () {
      it('returns a correct mbr', function () {
        expect(computeMbr(makeLinesSpatial(test[1]))).to.eql(test[2]);
      });
    });
  });
});

describe('Given a polygon', () => {
  const tests: [string, string[][], number[]][] = [
    [
      'simple box',
      [['0 35 0 40 10 40 10 35 0 35']],
      [35, 0, 40, 10.00933429],
    ],
    [
      'box across the antimeridian',
      [['-10 175 -10 -175 10 -175 10 175 -10 175']],
      [175, -10.03742305, -175, 10.03742305],
    ],
    [
      'multi-polygon',
      [['0 35 0 40 10 40 10 35 0 35'], ['-10 50 -10 55 0 55 0 50 -10 50']],
      [35, -10.00933429, 55, 10.00933429],
    ],
    [
      'box over the north pole',
      [['80 0 80 100 80 -170 80 -20 80 0']],
      [-180, 80, 180, 90],
    ],
    [
      'box over the south pole',
      [['-80 0 -80 -100 -80 170 -80 20 -80 0']],
      [-180, -90, 180, -80],
    ],
  ];

  tests.forEach((test) => {
    describe(`when the polygon is a ${test[0]}`, function () {
      it('returns a correct mbr', function () {
        expect(computeMbr(makePolygonsSpatial(test[1]))).to.eql(test[2]);
      });
    });
  });
});
