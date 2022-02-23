
import { TemporalRange } from '../../../models/data-operation';

const rangeSeparator = ':';
const unbounded = '*';
// Regex to match lat(-10:10) or lon(*:20)
const numberRangeRegex = new RegExp(`^(\\w+)\\((.+)${rangeSeparator}(.+)\\)$`);

// time("2001-05-01T12:35:00Z":"2002-07-01T13:18:55Z")
const twoStringsRegex = new RegExp(`^(\\w+)\\("(.+)"${rangeSeparator}"(.+)"\\)$`);
// time(*:"2001-05-01T12:35:00Z")
const unboundedMinStringRegex = new RegExp(`^(\\w+)\\((\\*)${rangeSeparator}"(.+)"\\)$`);
// time("2001-05-01T12:35:00Z":*)
const unboundedMaxStringRegex = new RegExp(`^(\\w+)\\("(.+)"${rangeSeparator}(\\*)\\)$`);
// time(*:*)
const unboundedStringRegex = new RegExp(`^(\\w+)\\((\\*)${rangeSeparator}(\\*)\\)`);
// time(*)
const singleUnboundedStringRegex = new RegExp('^(\\w+)\\((\\*)\\)$');
// time("2001-05-01T12:35:00Z")
const singleStringRegex = new RegExp('^(\\w+)\\("(.+)"\\)$');
// Date ranges can have several different representations
const dateTimeRegex = new RegExp(`${twoStringsRegex.source}|${unboundedMinStringRegex.source}|${unboundedMaxStringRegex.source}|${unboundedStringRegex.source}|${singleStringRegex.source}|${singleUnboundedStringRegex.source}`);

interface Dimension {
  name?: string;
  min?: number;
  max?: number;
  lowToHigh?: boolean;
  type?: (NumberConstructor | DateConstructor | StringConstructor);
  regex?: RegExp;
}

interface DimensionConfig {
  [key: string]: Dimension;
}

interface Range<T> {
  min?: T;
  max?: T;
}

interface DimensionRanges {
  [key: string]: Range<unknown>;
}

const dimensionConfig: DimensionConfig = {
  lat: {
    name: 'lat',
    min: -90,
    max: 90,
    lowToHigh: true,
    type: Number,
    regex: numberRangeRegex,
  },
  lon: {
    name: 'lon',
    min: -180,
    max: 180,
    lowToHigh: false, // Max longitude is allowed to be lower than min across the antimeridian
    type: Number,
    regex: numberRangeRegex,
  },
  time: {
    name: 'time',
    lowToHigh: true,
    type: Date,
    regex: dateTimeRegex,
  },
};

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
 * Helper function for subset parameters that parses and validates numeric values
 * specified in subset parameters, including "*"
 *
 * @param dim - information about the dimension (see dimensionInfo)
 * @param valueStr - the unparsed number as it appears in the input
 * @param defaultValue - the value to return if "*" is specified
 * @returns the parsed result
 * @throws ParameterParseError - if there are errors while parsing
 */
function parseNumeric(dim: Dimension, valueStr: string, defaultValue: number): number {
  const { name, min, max } = dim;

  if (valueStr === unbounded) {
    return defaultValue;
  }
  // The `+` strictly converts a string to a number or NaN if it's invalid
  const value = +valueStr;
  if (Number.isNaN(value)) {
    throw new ParameterParseError(`subset dimension "${name}" has an invalid numeric value "${valueStr}"`);
  }
  if (min !== undefined && value < min) {
    throw new ParameterParseError(`subset dimension "${name}" values must be greater than ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new ParameterParseError(`subset dimension "${name}" values must be less than ${max}`);
  }
  return value;
}

/**
 * Helper function for subset parameters that parses and validates date values
 * specified in subset parameters, including ".."
 *
 * @param dim - information about the dimension (see dimensionInfo)
 * @param valueStr - the unparsed date as it appears in the input
 * @returns the parsed date or undefined if the open range indicator is specified
 * @throws ParameterParseError - if there are errors while parsing
 */
function parseDate(dim: Dimension, valueStr: string): Date {
  const { name } = dim;

  if (valueStr === unbounded) {
    return undefined;
  }
  const value = new Date(valueStr);

  if (Number.isNaN(+value)) {
    throw new ParameterParseError(`subset dimension "${name}" has an invalid date time "${valueStr}"`);
  }

  return value;
}

const dimensionNameRegex = /^(\w+)\(.+\)$/;

/**
 * Returns the dimension name (e.g. time, lat, lon) from the value provided.
 * A valid example value is lat(-10:10).
 * @param value - The value of the subset parameter
 * @returns the dimension name
 */
function _getDimensionName(value: string): string {
  try {
    const match = value.match(dimensionNameRegex);
    const [, dimName] = match;
    return dimName;
  } catch (e) {
    throw new ParameterParseError(`unable to parse subset dimension from value "${value}"`);
  }
}

/**
 * Parses the provided point parameters and ensures they are valid, throwing an error message
 * if not
 *
 * @param values - An array of all the specified subset= parameters from the request
 * @param dimConfig - A mapping of dimension names to min, max, and data type values,
 *   see `dimensionInfo` (the default value) in this file.  Usually should not be specified,
 *   except for testing.
 * @returns An array with two elements corresponding to [longitude, latitude]
 * @throws ParameterParseError - if a subset parameter cannot be parsed, has unrecognized
 *   axis names, or is otherwise invalid
 */
export function parsePointParam(
  values: string,
  dimConfig: DimensionConfig = dimensionConfig,
): number[] {
  let results;
  let coordinate, coordinates;
  if (values !== undefined){
    coordinates = values;
    if ( coordinates.length !== 2 )
      throw new ParameterParseError(`wrong number of spatial coordinates provided in "${values}"`);

    results = ['lon', 'lat'].map( (dimName, idx): number => {
      const dim = dimConfig[dimName];
      coordinate = coordinates[idx];
      if (Number.isNaN(coordinate)) {
        throw new ParameterParseError(`dimension "${dimName}" has an invalid numeric value "${coordinate}"`);
      }
      if (coordinate < dim.min || coordinate > dim.max) {
        throw new ParameterParseError(`dimension "${dimName}" value must be between ${dim.min} and ${dim.max}`);
      }
      return coordinate;
    });
  }
  return results;
}

/**
 * Parses the provided subset parameters and ensures they are valid, throwing an error message
 * if not
 *
 * @param values - An array of all the specified subset= parameters from the request
 * @param dimConfig - A mapping of dimension names to min, max, and data type values,
 *   see `dimensionInfo` (the default value) in this file.  Usually should not be specified,
 *   except for testing.
 * @returns An object mapping dimension names to objects with min and max ranges
 * @throws ParameterParseError - if a subset parameter cannot be parsed, has unrecognized
 *   axis names, or is otherwise invalid
 */
export function parseSubsetParams(
  values: string[],
  dimConfig: DimensionConfig = dimensionConfig,
): DimensionRanges {
  const result: DimensionRanges = {};
  for (const value of values) {
    const dimName = _getDimensionName(value);
    const dim = dimConfig[dimName];
    if (!dim) {
      throw new ParameterParseError(`unrecognized subset dimension "${dimName}"`);
    }
    const match = value.match(dim.regex);
    if (!match) {
      throw new ParameterParseError(`subset dimension "${dim.name}" could not be parsed`);
    }
    const matches = match.filter((v) => v);
    const minStr = matches[2];
    // When just a single value is provided treat it as a range with the same min and max
    const maxStr = matches[3] || minStr;
    const parsed: Range<unknown> = {};

    if (result[dim.name]) {
      throw new ParameterParseError(`subset dimension "${dim.name}" was specified multiple times`);
    }
    switch (dim.type) {
      case Number:
        parsed.min = parseNumeric(dim, minStr, dim.min);
        parsed.max = parseNumeric(dim, maxStr, dim.max);
        break;
      case Date:
        parsed.min = parseDate(dim, minStr);
        parsed.max = parseDate(dim, maxStr);
        break;
      default:
      // Cannot be reached with current config.
        if (minStr !== unbounded) parsed.min = minStr;
        if (maxStr !== unbounded) parsed.max = maxStr;
    }
    const { min, max } = parsed;
    if (dim.lowToHigh && min !== undefined && max !== undefined && min > max) {
      throw new ParameterParseError(`subset dimension "${dim.name}" values must be ordered from low to high`);
    }
    result[dim.name] = parsed;
  }
  return result;
}

/**
 * Given a set of parsed subset params, as returned by `parseSubsetParams`, returns a bbox
 * array corresponding to the set value.  If only one of lat or lon is specified, sets the
 * other to full coverage.  If neither is specified, returns null.
 *
 * @param values - parsed, valid subset params, as returned by `parseSubsetParams`
 * @returns An array of 4 numbers corresponding to the [West, South, East, North]
 *   bounding box, or null if there is no lat or lon subsetting in values
 */
export function subsetParamsToBbox(
  values: { lat?: Range<number>; lon?: Range<number>; time?: Range<Date> },
): number[] {
  let { lat, lon } = values;
  if (!lat && !lon) {
    return null;
  }
  if (!lat) {
    lat = { min: -90, max: 90 };
  }
  if (!lon) {
    lon = { min: -180, max: 180 };
  }
  return [lon.min, lat.min, lon.max, lat.max];
}

/**
 * Given a set of parsed subset params, as returned by `parseSubsetParams`, returns an object
 * containing start and end if applicable.
 *
 * @param values - parsed, valid subset params, as returned by `parseSubsetParams`
 * @returns A temporal range with start and end fields if applicable
 */
export function subsetParamsToTemporal(
  values: { lat?: Range<number>; lon?: Range<number>; time?: Range<Date> },
): TemporalRange {
  const { time } = values;
  const temporal: TemporalRange = {};
  if (time) {
    if (time.min) {
      temporal.start = time.min;
    }
    if (time.max) {
      temporal.end = time.max;
    }
  }
  return temporal;
}
