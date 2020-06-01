import boxStringsToBox from 'util/bounding-box';
import Arc from './arc';
import { Coordinate, LatLng } from './coordinate';
import { getShape } from './geo';

/**
 * Circular max
 * @param lng0 - the first longitude
 * @param lng1 - the second longitude
 * @returns max - the right most longitude of the shortest arc joining the given longitudes
 */
function circularMax(lng0: number, lng1: number): number {
  const [left, right] = Array.from(lng0 < lng1 ? [lng0, lng1] : [lng1, lng0]);
  if ((right - left) < 180) {
    return right;
  }
  return left;
}

/**
 * Circular min
 * @param lng0 - the first longitude
 * @param lng1  - the second longitude
 * @returns min - the left most longitude of the shortest arc joining the given longitudes
 */
function circularMin(lng0: number, lng1: number): number {
  if (circularMax(lng0, lng1) === lng1) {
    return lng0;
  }
  return lng1;
}

export type Mbr = [number, number, number, number];

/**
 * Finds simple mbr
 * @param latlngs - an array of LatLng (lat/lng) pairs
 * @returns a tuple of the form [minLat, minLng, maxLat, maxLng]
 */
function findSimpleMbr(latlngs: LatLng[]): Mbr {
  let minLat = 91;
  let maxLat = -91;
  let minLng = 181;
  let maxLng = -181;

  const coords = (latlngs.map((latlng) => Coordinate.fromLatLng(latlng)));

  const len = coords.length;
  const latLngsWithInflections = [];
  coords.forEach((coord, i) => {
    latLngsWithInflections.push(coord.toLatLng());
    const next = coords[(i + 1) % len];
    const inflection = new Arc(coord, next).inflection();
    if (inflection) {
      const latLng = inflection.toLatLng();
      if (Math.abs(latLng.lat) !== 90) {
        // Has an inflection point, and it's not at the pole (which is handled
        // separately for MBRs)
        latLngsWithInflections.push(latLng);
      }
    }
  });

  const first = latLngsWithInflections[0];
  maxLat = first.lat;
  minLat = maxLat;
  maxLng = first.lng;
  minLng = maxLng;

  latLngsWithInflections.slice(1).forEach(({ lat, lng }) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    if (Math.abs(lat) !== 90) {
      minLng = circularMin(minLng, lng);
      maxLng = circularMax(maxLng, lng);
    } else {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  });

  return [minLat, minLng, maxLat, maxLng];
}
/**
 * Returns the distance of lng0 from the interval, a negative number
 * if it's outside and below the interval, a positive if it's outside
 * and above, and 0 if it's within the interval
 *
 * @param lng0 - the longitude
 * @param min  - the lower bound of the interval
 * @param max - the upper bound of the interval
 * @returns a number indicating the relative position of the given longitude
 */
function distance(lng0: number, min: number, max: number): number {
  let newLng0 = lng0;
  let newMin = min;
  let newMax = max;

  newMin += 720;
  while (newMax < newMin) { newMax += 360; }
  const mid = newMin + ((newMax - newMin) / 2);
  while (newLng0 < (mid - 180)) { newLng0 += 360; }

  if (newLng0 < newMin) {
    return newMin - newLng0;
  } if (newLng0 > newMax) {
    return newLng0 - newMax;
  }
  return 0;
}

/**
 * Merges mbrs
 * @param mbrs - an array of MBRs
 * @returns a single MBR that encompasses all the given MBRs
 */
function mergeMbrs(mbrs: Mbr[]): Mbr {
  const [first, ...rest] = mbrs;
  let [minLat, minLng, maxLat, maxLng] = first;

  rest.forEach(([lat0, lng0, lat1, lng1]) => {
    minLat = Math.min(minLat, lat0);
    maxLat = Math.max(maxLat, lat1);

    const lng0Distance = distance(lng0, minLng, maxLng);
    const lng1Distance = distance(lng1, minLng, maxLng);
    const maxLngDistance = distance(maxLng, lng0, lng1);

    if ((lng0Distance === 0) || (lng1Distance === 0) || (maxLngDistance === 0)) {
      // If the ranges overlap
      minLng = circularMin(minLng, lng0);
      maxLng = circularMax(maxLng, lng1);
    } else {
      // If the ranges are disjoint
      // eslint-disable-next-line no-lonely-if
      if (lng0Distance < lng1Distance) {
        // Both points are on the same side
        if (lng0Distance < 0) {
          minLng = lng0;
        } else {
          maxLng = lng1;
        }
      } else {
        // The maximum point and minimum point are on opposite sides of the interval
        // eslint-disable-next-line no-lonely-if
        if (Math.abs(lng0Distance - 360) < Math.abs(lng1Distance + 360)) {
          // It's closer to extend to the minimum
          minLng = lng0;
        } else {
          maxLng = lng1;
        }
      }
    }
  });

  return [minLat, minLng, maxLat, maxLng];
}

/**
 * Divides mbr at antimeridian
 * @param mbr A minimum bounding rectangle
 * @returns an array of Mbrs that don't cross the antimeridian
 */
export function divideMbr(mbr: Mbr): Mbr[] {
  const [minLat, minLng, maxLat, maxLng] = Array.from(mbr);
  if (maxLng < minLng) {
    return [[minLat, -180, maxLat, maxLng], [minLat, minLng, maxLat, 180]];
  }
  return minLng === maxLng ? [[minLat, -180, maxLat, 180]] : [mbr];
}

const EPSILON = 0.00000001;

export interface Spatial {
  boxes?: string[];
  points?: string[];
  lines?: string[];
  polygons?: string[][];
}

/**
 * Removes duplicate endpoint
 * @param ring - a list of coordinate pairs as a string
 * @returns a string with the duplicate endpoint (if any) removed
 */
function removeDuplicateEndpoint(ring: string): string {
  let coords = ring.split(' ');
  const len = coords.length;

  if (len > 5 && coords[0] === coords[len - 1] && coords[1] === coords[len - 2]) {
    coords = coords.slice(0, len - 2);
  }

  return coords.join(' ');
}

/**
 * Rounds mbr coordiinates
 * @param mbr - a minimal bounding box
 * @param precision - the number of decimal places to which to round each ordinate
 * @returns an Mbr with coordinates at the given precision
 */
function roundMbrCoordiinates(mbr: Mbr, precision = 8): Mbr {
  return mbr.map((ord: number) => {
    const fixed = ord.toFixed(precision);
    return parseFloat(fixed);
  }) as Mbr;
}

/**
 * Convert an Mbr in SWNE order to one in WSEN order
 * @param mbr an Mbr in SWNE order
 * @returns an Mbr in SWNE order
 */
function swneToWsen(mbr: Mbr): Mbr {
  return [mbr[1], mbr[0], mbr[3], mbr[2]];
}

/**
 * Normalizes mbr ordinates to be within -90:90, -180:180
 * @param mbr the Mbr to normalize
 * @returns An Mbr with east/west in the range -180:180 and north/south in the range -90:90
 */
function normalizeMbr(mbr: Mbr): Mbr {
  let [w, s, e, n] = mbr;
  if (s < -90) s = -90 - s;
  if (s > 90) s = 180 - s;
  if (n < -90) n = -90 - n;
  if (n > 90) n = 180 - n;
  if (w < -180) w = -180 - w;
  if (w > 180) w -= 360;
  if (e < -180) e = -180 - e;
  if (e > 180) e -= 360;

  return [w, s, e, n];
}

/**
 * Create an Mbr from a spatial object
 * @param spatial - a an object containing a point, bounding box, or polygon
 * @returns an MBR or undefined
 */
export function computeMbr(spatial: Spatial): Mbr | undefined {
  const { boxes, points, lines, polygons } = spatial;
  let mbrs;

  if (boxes) {
    return boxStringsToBox(boxes);
  } if (points) {
    mbrs = points.map((point: string): [number, number, number, number] => {
      const { lat, lng } = getShape(point)[0];
      return [lat - EPSILON, lng - EPSILON, lat + EPSILON, lng + EPSILON];
    });
  } else if (lines) {
    mbrs = lines.map((line: string): [number, number, number, number] => {
      const lineShape = getShape(line);
      return findSimpleMbr(lineShape);
    });
  } else if (polygons) {
    mbrs = polygons.map((polygon: string[]): [number, number, number, number] => {
      const outerRing = polygon[0];
      const polyShape = getShape(removeDuplicateEndpoint(outerRing));
      return findSimpleMbr(polyShape);
    });
  }

  return mbrs && normalizeMbr(swneToWsen(roundMbrCoordiinates(mergeMbrs(mbrs))));
}
