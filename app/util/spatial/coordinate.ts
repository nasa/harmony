const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

// Class for dealing with conversions between lat/lng, phi/theta, and x/y/z as well
// as operations on the various forms.
// Consider properties on this class to be immutable.  Changing, say, 'x' will not
// update `phi` or `theta` and will throw normalization out of whack.
export class Coordinate {
  phi: number;

  theta: number;

  x: number;

  y: number;

  z: number;

  static fromLatLng(...args: LatLng[] | number[]): Coordinate {
    let lat: number;
    let lng: number;
    if (args.length === 1) {
      [{ lat, lng }] = (args as LatLng[]);
    } else {
      [lat, lng] = (args as number[]);
    }
    return Coordinate.fromPhiTheta(lat * DEG_TO_RAD, lng * DEG_TO_RAD);
  }

  static fromPhiTheta(phi, theta): Coordinate {
    let newPhi = phi;
    let newTheta = theta;
    const { PI, cos, sin } = Math;

    const origTheta = newTheta;

    // Normalize phi to the interval [-PI / 2, PI / 2]
    while (newPhi >= PI) { newPhi -= 2 * PI; }
    while (newPhi < PI) { newPhi += 2 * PI; }

    if (newPhi > (PI / 2)) {
      newPhi = PI - newPhi;
      newTheta += PI;
    }
    if (newPhi < (-PI / 2)) {
      newPhi = -PI - newPhi;
      newTheta += PI;
    }

    while (newTheta >= PI) { newTheta -= 2 * PI; }
    while (newTheta < -PI) { newTheta += 2 * PI; }

    // Maintain the same sign as the original when theta is +/- PI
    if ((newTheta === -PI) && (origTheta > 0)) { newTheta = PI; }

    // At the poles, preserve the input longitude
    if (Math.abs(newPhi) === (PI / 2)) { newTheta = origTheta; }

    const x = cos(newPhi) * cos(newTheta);
    const y = cos(newPhi) * sin(newTheta);
    const z = sin(newPhi);

    return new Coordinate(newPhi, newTheta, x, y, z);
  }

  // +X axis passes through the (anti-)meridian at the equator
  // +Y axis passes through 90 degrees longitude at the equator
  // +Z axis passes through the north pole
  static fromXYZ(x, y, z): Coordinate {
    let newX = x;
    let newY = y;
    let newZ = z;
    let d = (newX * newX) + (newY * newY) + (newZ * newZ);
    if (d === 0) {
      newX = 1;
      d = 1;
    } // Should never happen, but stay safe

    // We normalize so that x, y, and z fall on a unit sphere
    const scale = 1 / Math.sqrt(d);
    newX *= scale;
    newY *= scale;
    newZ *= scale;

    const theta = Math.atan2(newY, newX);
    const phi = Math.asin(newZ);

    return new Coordinate(phi, theta, newX, newY, newZ);
  }

  constructor(phi, theta, x, y, z) {
    this.phi = phi;
    this.theta = theta;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // Dot product
  dot(other): number {
    return (this.x * other.x) + (this.y * other.y) + (this.z * other.z);
  }

  // Normalized cross product
  cross(other): Coordinate {
    const x = (this.y * other.z) - (this.z * other.y);
    const y = (this.z * other.x) - (this.x * other.z);
    const z = (this.x * other.y) - (this.y * other.x);
    return Coordinate.fromXYZ(x, y, z);
  }

  // Distance to other coordinate on a unit sphere.
  // Same as the angle between the two points at the origin.
  distanceTo(other: Coordinate): number {
    return Math.acos(this.dot(other));
  }

  toLatLng(): LatLng {
    const lat = RAD_TO_DEG * this.phi;
    const lng = RAD_TO_DEG * this.theta;
    return { lat, lng };
  }

  toString(): string {
    const latlng = this.toLatLng();
    return `(${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)})`;
  }

  toXYZString(): string {
    return `<${this.x.toFixed(3)}, ${this.y.toFixed(3)}, ${this.z.toFixed(3)}>`;
  }
}
