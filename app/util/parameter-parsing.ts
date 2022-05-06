import { RequestValidationError } from './errors';
import HarmonyRequest from '../models/harmony-request';

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
  throw new ParameterParseError('must be \'false\' or \'true\'');
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
