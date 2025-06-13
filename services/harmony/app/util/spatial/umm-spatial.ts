import { LatLng } from './coordinate';

export interface PointType {
  Longitude: number;
  Latitude: number;
}

export interface BoundingRectangleType {
  WestBoundingCoordinate: number;
  NorthBoundingCoordinate: number;
  EastBoundingCoordinate: number;
  SouthBoundingCoordinate: number;
}

export interface BoundaryType {
  Points: PointType[];
}

export interface ExclusiveZoneType {
  Boundaries: BoundaryType[];
}

export interface GPolygonType {
  Boundary: BoundaryType;
  ExclusiveZone?: ExclusiveZoneType;
}

export interface LineType {
  Points: PointType[];
}

export interface UmmSpatial {
  CoordinateSystem?: string;
  Points?: PointType[];
  BoundingRectangles?: BoundingRectangleType[];
  GPolygons?: GPolygonType[];
  Lines?: LineType[];
}

export interface VerticalSpatialDomainType {
  Type: 'Atmosphere Layer' | 'Maximum Altitude' | 'Maximum Depth' | 'Minimum Altitude' | 'Minimum Depth';
  Value: string;
}

/**
 * Takes a list of Points, convert it into an array of LatLng objects
 *
 * @param points - an array of Points
 * @returns shape - an array of LatLng objects
 */
export function getUmmShape(points: PointType[]): LatLng[] {
  return points.map((point) => {
    return { lat: point.Latitude, lng: point.Longitude };
  });
}
