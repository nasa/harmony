import { describe, it } from 'mocha';
import { expect } from 'chai';
import { LatLng } from '../../../app/util/spatial/coordinate';
import { calculateArea, getShape } from '../../../app/util/spatial/geo';

/**
 * Makes a LatLng object from a lat/lng tuple
 * @param latLng - latitude and longitude in tuple form
 * @returns a LatLng object
 */
function makeLatLng(latLng: [number, number]): LatLng {
  const [lat, lng] = latLng;
  return { lat, lng };
}

describe('geo#calculateArea', () => {
  // eslint-disable-next-line max-len
  const lls = (latlngs: [number, number][]): LatLng[] => Array.from(latlngs).map((ll: [number, number]) => makeLatLng(ll));

  it('returns 0 for strings of fewer than 3 lat lngs', () => {
    expect(calculateArea(lls([]))).to.eql(0);
    expect(calculateArea(lls([[0, 0]]))).to.eql(0);
    expect(calculateArea(lls([[0, 0], [10, 0]]))).to.eql(0);
  });

  it('determines correct polygon interior area for polygons containing no poles', () => {
    expect(calculateArea(
      lls([[0, 0], [0, 10], [10, 0]]),
    )).to.be.closeTo(0.015, 2);
  });

  it('determines correct polygon interior area for polygons crossing the antimeridian', () => {
    expect(calculateArea(
      lls([[0, 175], [0, -175], [10, 175]]),
    )).to.be.closeTo(0.015, 2);
  });

  it('determines correct polygon interior area for polygons containing the north pole', () => {
    expect(calculateArea(
      lls([[85, 0], [85, 120], [85, -120]]),
    )).to.be.closeTo(0.015, 2);

    expect(calculateArea(
      lls([[-85, 120], [-85, -120], [-85, 0]]),
    )).to.be.closeTo(12.55, 2);
  });

  it('determines correct polygon interior area for polygons containing the south pole', () => {
    expect(calculateArea(
      lls([[-85, 0], [-85, -120], [-85, 120]]),
    )).to.be.closeTo(0.015, 2);

    expect(calculateArea(
      lls([[85, -120], [85, 120], [85, 0]]),
    )).to.be.closeTo(12.55, 2);
  });

  it('determines correct polygon interior area for polygons containing the both poles', () => {
    expect(calculateArea(
      lls([[0, 0], [10, 0], [0, 10]]),
    )).to.be.closeTo(12.55, 2);
  });

  it('determines correct polygon interior area for polygons touching the north pole', () => {
    expect(calculateArea(
      lls([[85, 0], [85, 120], [90, 0]]),
    )).to.be.closeTo(0.004, 2);
  });

  it('determines correct polygon interior area for polygons touching the south pole', () => {
    expect(calculateArea(
      lls([[-85, 0], [-85, -120], [-90, 0]]),
    )).to.be.closeTo(0.004, 2);
  });

  it('determines correct polygon interior area for polygons touching the both poles', () => {
    expect(calculateArea(
      lls([[0, 5], [90, 0], [0, -5], [-90, 0]]),
    )).to.be.closeTo(0.30, 2);
  });
});

describe('geo#getShape', () => {
  it('getShape returns a shape', () => {
    const shape = getShape('0 10 10 20 15 5 0 10');

    expect(shape).to.eql([{
      lat: 0,
      lng: 10,
    }, {
      lat: 10,
      lng: 20,
    }, {
      lat: 15,
      lng: 5,
    }, {
      lat: 0,
      lng: 10,
    }]);
  });
});
