import { RequestValidationError } from './errors';
import HarmonyRequest from '../models/harmony-request';
import wellknown from 'wellknown';
import _ from 'lodash';

/**
 * Tag class for denoting errors during parsing
 *
 */
export class ParameterParseError extends Error { }

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
 * it was a string, or just returns the array if it's already parsed. Returns
 * an empty array if the parameter is null.
 * @param value - The parameter value to parse (either an array or a string)
 */
export function parseMultiValueParameter(value: string[] | string): string[] {
  if (value === null) {
    return [];
  }
  if (value instanceof Array) {
    return value;
  }
  return value.split(',').map((v) => v.trim());
}

const geoJsonTemplate =
{
  'type': 'FeatureCollection',
  'features': [

    {
      'type': 'Feature',
      'geometry': {},
      'properties': {},
    },
  ],
};

/**
 * Validate the WKT from the query parameter and throw error if invalid.
 *
 * @param wkt - The WKT string to be validated.
 * @throws RequestValidationError if the WKT string is invalid.
 */
export function validateWkt(wkt: string): void {
  try {
    const parsed = wellknown.parse(wkt);
    if (parsed === null || parsed === undefined) {
      throw new RequestValidationError(`query parameter "coords" Invalid WKT string: ${wkt}`);
    }
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      throw new RequestValidationError(`query parameter "coords" ${e.message}`);
    }
    throw e;
  }
}

/**
 * Parses portion of WKT that are supported as parameters in harmony.
 * @param wkt - The WKT string
 * @returns GeoJSON object representation of the WKT string
 * @throws ParameterParseError if it cannot be parsed or harmony does not support the WKT type
 */
export function parseWkt(wkt: string): Object {
  // TODO - Will implement lines and points in separate tickets
  // const supportedTypes = ['Polygon', 'MultiPolygon', 'Point', 'MultiPoint', 'LineString', 'MultiLineString'];
  const supportedTypes = ['Polygon', 'MultiPolygon'];
  let wktGeoJson;
  const geoJson = _.cloneDeep(geoJsonTemplate);
  try {
    wktGeoJson = wellknown.parse(wkt);
  } catch (e) {
    throw new ParameterParseError(`Unable to parse WKT string ${wkt}.`);
  }
  if (wktGeoJson) {
    if (!supportedTypes.includes(wktGeoJson.type)) {
      throw new ParameterParseError(`Unsupported WKT type ${wktGeoJson.type}.`);
    }
    geoJson.features[0].geometry = wktGeoJson;

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
