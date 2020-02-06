const dimensionConfig = {
  lat: {
    name: 'lat',
    min: -90,
    max: 90,
    lowToHigh: true,
    type: Number,
  },
  lon: {
    name: 'lon',
    min: -180,
    max: 180,
    lowToHigh: false, // Max longitude is allowed to be lower than min across the antimeridian
    type: Number,
  },
};

/**
 * Tag class for denoting errors during parsing
 *
 * @class ParameterParseError
 * @extends {Error}
 */
class ParameterParseError extends Error {}

/**
 * Helper function for subset parameters that parses and validates numeric values
 * specified in subset parameters, including "*"
 *
 * @param {object} dim information about the dimension (see dimensionInfo)
 * @param {string} valueStr the unparsed number as it appears in the input
 * @param {Number} defaultValue the value to return if "*" is specified
 * @returns {Number} the parsed result
 * @throws {ParameterParseError} if there are errors while parsing
 */
function parseNumeric(dim, valueStr, defaultValue) {
  if (valueStr === '*') {
    return defaultValue;
  }
  const { name, min, max } = dim;
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
 * Parses the provided subset parameters and ensures they are valid, throwing an error message
 * if not
 *
 * @param {string[]} values An array of all the specified subset= parameters from the request
 * @param {object} dimConfig A mapping of dimension names to min, max, and data type values,
 *   see `dimensionInfo` (the default value) in this file.  Usually should not be specified,
 *   except for testing.
 * @returns {object} An object mapping dimension names to objects with min and max ranges
 * @throws {ParameterParseError} if a subset parameter cannot be parsed, has unrecognized
 *   axis names, or is otherwise invalid
 */
function parseSubsetParams(values, dimConfig = dimensionConfig) {
  // Regex for "___(___:___)"
  const regex = /^(\w+)\((.+):(.+)\)$/;
  const result = {};
  for (const value of values) {
    const match = value.match(regex);
    if (!match) {
      throw new ParameterParseError('could not be parsed');
    }
    const [, dimName, minStr, maxStr] = match;
    const dim = dimConfig[dimName];
    const parsed = {};
    if (!dim) {
      throw new ParameterParseError(`unrecognized subset dimension "${dimName}"`);
    }
    if (dim.type === Number) {
      if (result[dim.name]) {
        throw new ParameterParseError(`subset dimension "${dim.name}" was specified multiple times`);
      }
      parsed.min = parseNumeric(dim, minStr, dim.min);
      parsed.max = parseNumeric(dim, maxStr, dim.max);
      const { min, max } = parsed;
      if (dim.lowToHigh && min !== undefined && max !== undefined && min > max) {
        throw new ParameterParseError(`subset dimension "${dim.name}" values must be ordered from low to high`);
      }
    } else {
      // Cannot be reached with current config.  We will eventually need other types like Date
      if (minStr !== '*') parsed.min = minStr;
      if (maxStr !== '*') parsed.max = maxStr;
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
 * @param {object} values parsed, valid subset params, as returned by `parseSubsetParams`
 * @returns {number[]} An array of 4 numbers corresponding to the [West, South, East, North]
 *   bounding box, or null if there is no lat or lon subsetting in values
 */
function subsetParamsToBbox(values) {
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

module.exports = {
  parseSubsetParams,
  subsetParamsToBbox,
  ParameterParseError,
};
