import { BoundingRectangleType } from './spatial/umm-spatial';

const { max, min } = Math;

export type BoundingBox = [number, number, number, number];

/**
 * Convert a bounding box string in `'S W N E'` format to a tuple in `[W,S,E,N]` format.
 *
 * @param str -  bounding box string in `'S W N E'` format.
 * @returns a bounding box in `[W,S,E,N]` format
 */
function _boundingBoxStringToBoundingBox(str: string): BoundingBox {
  if (!str) return null;

  const ords = str.split(' ').map(parseFloat);
  if (ords.length !== 4) {
    throw new Error(`expected bounding box to have 4 bounds, got ${ords.length}`);
  }

  return [ords[1], ords[0], ords[3], ords[2]];
}

/**
 * Determine whether or not a box crosses the antimeridian
 *
 * @param box - a box in `[W,S,E,N]` format
 * @returns true if the box crosses the antimeridian, false otherwise
 */
function crossesAntimeridian(box: BoundingBox): boolean {
  // true if W > E
  return box[0] > box[2];
}

/**
 * Find a minimal bounding box around every input rectangle.
 *
 * Preserve longitude intervals until they have all been merged. The complement
 * of their largest uncovered gap is the shortest containing arc on the globe.
 * Combining envelopes pairwise can prematurely fill the gap needed by a later box.
 *
 * @param boxes - Boxes in `[W,S,E,N]` format
 * @returns A containing box with minimal longitudinal width
 */
function joinBoundingBoxes(boxes: BoundingBox[]): BoundingBox {
  const intervals: [number, number][] = [];
  let south = boxes[0][1];
  let north = boxes[0][3];
  for (const box of boxes) {
    south = min(south, box[1]);
    north = max(north, box[3]);
    if (crossesAntimeridian(box)) {
      intervals.push([-180, box[2]], [box[0], 180]);
    } else {
      intervals.push([box[0], box[2]]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || start > previous[1]) {
      merged.push([start, end]);
    } else {
      previous[1] = max(previous[1], end);
    }
  }

  // Prefer a non-crossing box when gaps have equal widths.
  let west = merged[0][0];
  let east = merged[merged.length - 1][1];
  let largestGap = west + 360 - east;
  for (let index = 1; index < merged.length; index++) {
    const gap = merged[index][0] - merged[index - 1][1];
    if (gap > largestGap) {
      largestGap = gap;
      west = merged[index][0];
      east = merged[index - 1][1];
    }
  }
  return [west, south, east, north];
}

/**
 * Convert an array of strings representing bounding boxes to a single array of numbers
 * representing a minimal bounding box that contains all of the sub bounding boxes
 *
 * @param boxStrings - a list of strings in `'S W N E'` format
 * @returns a tuple of floats in `[W,S,E,N]` format
 */
export default function boxStringsToBox(boxStrings: string[]): BoundingBox {
  if (!boxStrings || boxStrings.length === 0) return null;

  const boxes = boxStrings.map(_boundingBoxStringToBoundingBox).filter((val) => val);
  if (boxes.length === 1) return boxes[0];

  // find a single minimal bounding box that contains all the boxes
  return joinBoundingBoxes(boxes);
}

/**
 * Convert a UMM BoundingRectangleType to a BoundingBox
 *
 * @param br - a bounding rectangle in the form of a map of WestBoundingCoordinate,
 * SouthBoundingCoordinate, EastBoundingCoordinate and NorthBoundingCoordinate
 * @returns a tuple of floats in `[W,S,E,N]` format
 */
export function boundingRectangleToBox(br: BoundingRectangleType): BoundingBox {
  const { WestBoundingCoordinate, SouthBoundingCoordinate, EastBoundingCoordinate, NorthBoundingCoordinate } = br;
  return [WestBoundingCoordinate, SouthBoundingCoordinate, EastBoundingCoordinate, NorthBoundingCoordinate];
}

/**
 * Convert an array of bounding boxes to a minimal bounding box that contains all of the sub bounding boxes
 *
 * @param brs - a list of BoundingRectangleTypes
 * @returns a tuple of floats in `[W,S,E,N]` format
 */
export function boundingRectanglesToBox(brs: BoundingRectangleType[]): BoundingBox {
  if (!brs || brs.length === 0) return null;
  const boxes = brs.map(boundingRectangleToBox);
  if (boxes.length === 1) return boxes[0];

  // find a single minimal bounding box that contains all the boxes
  return joinBoundingBoxes(boxes);
}
