import { RequestValidationError } from './errors';
import HarmonyRequest from '../models/harmony-request';
import wellknown, { GeoJSONGeometryOrNull } from 'wellknown';

/**
 * Tag class for denoting errors during parsing
 *
 */
export class ParameterParseError extends Error {}

/**
  * Helper function for parameters that parses and validates boolean values. A null value
  * defaults to false.
  *
  * @param valueStr - the unparsed boolean as it appears in the input
  * @returns the parsed result
  * @throws ParameterParserError - if there are errors while parsing
  */
export function parseBoolean(valueStr: string): boolean {
  if (!valueStr) return false;
  if (valueStr.toLowerCase() === 'true') return true;
  if (valueStr.toLowerCase() === 'false') return false;
  throw new ParameterParseError(`'${valueStr}' must be \'false\' or \'true\'`);
}

/**
 * Helper function for parameters that parses and validates numerical values.
 * If the input string is not numerical, a ParameterParseError is thrown.
 *
 * @param valueStr - the unparsed number as it appears in the input
 * @returns the parsed result
 * @throws ParameterParseError - if there are errors while parsing (e.g., a NaN)
 */
export function parseNumber(valueStr: string | number): number {
  const parsedNumber = Number(valueStr);
  if (isNaN(parsedNumber)) {
    throw new ParameterParseError(`'${valueStr}' must be a number.`);
  }
  return parsedNumber;
}

/**
 * Returns the parameter as parsed as an array of comma-separated values if
 * it was a string, or just returns the array if it's already parsed
 * @param value - The parameter value to parse (either an array or a string)
 */
export function parseMultiValueParameter(value: string[] | string): string[] {
  if (value instanceof Array) {
    return value;
  }
  return value.split(',').map((v) => v.trim());
}

/**
 * Parses portion of WKT that are supported as parameters in harmony.
 * @param wkt - The WKT string
 * @returns wellknown GeoJSON representation of the WKT string
 * @throws ParameterParseError if it cannot be parsed or harmony does not support the WKT type
 */
export function parseWkt(wkt: string): GeoJSONGeometryOrNull {
  // TODO - Will implement lines and points in separate tickets
  // const supportedTypes = ['Polygon', 'MultiPolygon', 'Point', 'MultiPoint', 'LineString', 'MultiLineString'];
  const supportedTypes = ['Polygon', 'MultiPolygon'];
  let geoJson;
  try {
    geoJson = wellknown.parse(wkt);
  } catch (e) {
    throw new ParameterParseError(`Unable to parse WKT string ${wkt}.`);
  }
  if (geoJson) {
    if (!supportedTypes.includes(geoJson.type)) {
      throw new ParameterParseError(`Unsupported WKT type ${geoJson.type}.`);
    }
  } else {
    throw new ParameterParseError(`Unable to parse WKT string ${wkt}.`);
  }
  return geoJson;
}

/**
 * Merge request parameters from body to query
 * It will throw an exception if duplicate keys are found request body and query string
 *
 * @param req - The harmony request
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export function mergeParameters(req: HarmonyRequest): void {
  const queryKeys = Object.keys(req.query);
  const bodyKeys = Object.keys(req.body);
  const duplicateKeys = queryKeys.filter((x) => bodyKeys.includes(x));
  if (duplicateKeys.length) {
    throw new RequestValidationError(`Duplicate keys "${duplicateKeys}" found from request body and query string!`);
  }
  req.query = { ...req.query, ...req.body };
}
