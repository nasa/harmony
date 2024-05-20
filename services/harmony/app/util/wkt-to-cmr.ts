import { CmrQuery } from './cmr';
import { parseWkt } from './parameter-parsing-helpers';

/**
 * Converts GeoJSON coordinates to a CMR-compatible flattened string
 * @param coordinates - Array of coordinates (nested array format)
 * @returns CMR-compatible flattened string
 */
function flattenCoordinates(coordinates: number[] | number[][] | number[][][]): string {
  const flatCoordinates = coordinates.flat();
  return flatCoordinates.join(',');
}

/**
 * Parses WKT to CMR query parameters
 * @param wkt - The WKT string to convert
 * @returns An object with the appropriate query parameters for the CMR API
 */
export function wktToCmrQueryParams(wkt: string): CmrQuery {
  const geoJson = parseWkt(wkt);
  const queryParams: CmrQuery = {};

  console.log(`GeoJSON: ${JSON.stringify(geoJson)}`);
  switch (geoJson.type) {
    case 'Polygon':
      // Both WKT and CMR specify the polygon in counter-clockwise order so no need to reorder
      // points. They both also require the first and last point to be the same so no need to do
      // anything. CMR does NOT support interior polygon holes, so we only look at the outer
      // polygons list.
      queryParams['polygon[]'] = flattenCoordinates(geoJson.coordinates[0]);
      break;
    case 'MultiPolygon':
      // Similar to polygon - the polygonWrapper is an array with the first element being the
      // outer polygon and the second element an interior hole. We ignore the interior hole
      queryParams['polygon[]'] = geoJson.coordinates.map((polygonWrapper) => flattenCoordinates(polygonWrapper[0]));
      break;
    case 'LineString':
      // Assuming that both WKT and CMR use (lon, lat) in that order for each coordinate
      queryParams['line[]'] = flattenCoordinates(geoJson.coordinates);
      break;
    case 'Point':
      queryParams.point = flattenCoordinates(geoJson.coordinates);
      break;
    default:
      throw new Error(`Unsupported type: ${geoJson.type}`);
  }

  return queryParams;
}
