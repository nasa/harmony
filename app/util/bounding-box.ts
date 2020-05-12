const { max, min } = Math;

/**
 * Convert a bounding box string in `'S W N E'` format to an array in `[W,S,E,N]` format.
 *
 * @param {string} str A bounding box string in `'S W N E'`` format.
 * @returns {Array<number>} A bounding box in `[W,S,E,N]` format
 * @private
 */
function _boundingBoxStringToBoundingBox(str: string): Array<number> {
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
 * @param {Array<number>} box A box in `[W,S,E,N]` format
 * @returns {boolean} true if the box crosses the antimeridian, false otherwise
 * @private
 */
function _crossesAntimeridian(box: Array<number>): boolean {
  // true if W > E
  return box[0] > box[2];
}

/**
 * Join two bounding boxes to create a single box that is the minimal bounding box
 * encompassing the two.
 * Note: this was translated from the CMR Clojure version
 *
 * @param {Array<number>} box1 A box in `[W,S,E,N]` format
 * @param {Array<number>} box2 A box in `[W,S,E,N]` format
 * @returns {Array<number>} A box in `[W,S,E,N]` format
 * @private
 */
function _joinBoundingBoxes(box1: Array<number>, box2: Array<number>): Array<number> {
  // longitude range union
  let w;
  let e;
  if (_crossesAntimeridian(box1) && _crossesAntimeridian(box2)) {
    // both cross the antimeridian
    w = min(box1[0], box2[0]);
    e = max(box1[2], box2[2]);
    if (w <= e) {
      // if the result covers the whole world then we'll set it to that.
      w = -180.0;
      e = 180.0;
    }
  } else if (_crossesAntimeridian(box1) || _crossesAntimeridian(box2)) {
    // one crosses the antimeridian
    let b1;
    let b2;
    if (_crossesAntimeridian(box2)) {
      b1 = box2;
      b2 = box1;
    } else {
      b1 = box1;
      b2 = box2;
    }
    const w1 = b1[0];
    const w2 = b2[0];
    const e1 = b1[2];
    const e2 = b2[2];
    // We could expand b1 to the east or to the west. Pick the shorter of the two.
    const westDist = w1 - w2;
    const eastDist = e1 - e2;
    if (westDist <= 0 || eastDist >= 0) {
      w = w1;
      e = e1;
    } else if (eastDist < westDist) {
      w = w1;
      e = e2;
    } else {
      w = w2;
      e = e1;
    }

    if (w <= e) {
      // if the result covers the whole world then we'll set it to that.
      w = -180.0;
      e = 180.0;
    }
  } else {
    // neither cross the AM
    let b1;
    let b2;
    if (box1[0] > box2[0]) {
      b1 = box2;
      b2 = box1;
    } else {
      b1 = box1;
      b2 = box2;
    }
    const w1 = b1[0];
    const w2 = b2[0];
    const e1 = b1[2];
    const e2 = b2[2];

    w = min(w1, w2);
    e = max(e1, e2);

    // Check if it's shorter to cross the AM
    const dist = e - w;
    const altWest = w2;
    const altEast = e1;
    const altDist = (180.0 - altWest) + (altEast + 180.0);

    if (altDist < dist) {
      w = altWest;
      e = altEast;
    }
  }

  // latitude range union
  const n = max(box1[3], box2[3]);
  const s = min(box1[1], box2[1]);

  return [w, s, e, n];
}

/**
 * Convert an array of strings representing bounding boxes to a single array of numbers
 * representing a minimal bounding box that contains all of the sub bounding boxes
 *
 * @param {Array<string>} boxStrings a list of strings in `'S W N E'` format
 * @returns {Array<number>} an array of floats in `[W,S,E,N]` format
 */
export default function boxStringsToBox(boxStrings: Array<string>): Array<number> {
  if (!boxStrings || boxStrings.length === 0) return null;

  const boxes = boxStrings.map(_boundingBoxStringToBoundingBox).filter((val) => val);
  if (boxes.length === 1) return boxes[0];

  // find a single minimal bounding box that contains all the boxes
  return boxes.reduce((mbr, nextBox) => _joinBoundingBoxes(mbr, nextBox));
}
