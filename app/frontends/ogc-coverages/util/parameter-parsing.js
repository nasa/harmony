const dimensionConfig = {
  lat: {
    name: 'lat',
    min: -90,
    max: 90,
    lowToHigh: true,
    type: Number,
    rangeSeparator: ':',
    anyValue: '*',
  },
  lon: {
    name: 'lon',
    min: -180,
    max: 180,
    lowToHigh: false, // Max longitude is allowed to be lower than min across the antimeridian
    type: Number,
    rangeSeparator: ':',
    anyValue: '*',
  },
  time: {
    name: 'time',
    lowToHigh: true,
    type: Date,
    rangeSeparator: '/',
    anyValue: '..',
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
  const { name, min, max, anyValue } = dim;

  if (valueStr === anyValue) {
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
 * @param {object} dim information about the dimension (see dimensionInfo)
 * @param {string} valueStr the unparsed date as it appears in the input
 * @returns {Date} the parsed date or undefined if the open range indicator is specified
 * @throws {ParameterParseError} if there are errors while parsing
 */
function parseDate(dim, valueStr) {
  const { name, anyValue } = dim;

  if (valueStr === anyValue) {
    return undefined;
  }

  const value = Date.parse(valueStr);
  if (Number.isNaN(value)) {
    throw new ParameterParseError(`subset dimension "${name}" has an invalid date time "${valueStr}"`);
  }

  return new Date(value);
}


const dimensionNameRegex = /^(\w+)\(.+\)$/;

/**
 * Returns the dimension name (e.g. time, lat, lon) from the value provided.
 * A valid example value is lat(-10:10).
 * @param {String} value The value of the subset parameter
 * @returns {String} the dimension name
 */
function _getDimensionName(value) {
  const match = value.match(dimensionNameRegex);
  const [, dimName] = match;
  return dimName;
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
  const result = {};
  for (const value of values) {
    const dimName = _getDimensionName(value);
    const dim = dimConfig[dimName];
    if (!dim) {
      throw new ParameterParseError(`unrecognized subset dimension "${dimName}"`);
    }
    // Regex to match lat(-10:10) or time(2010-01-01T01:01:00Z/2011-01-01T01:01:00Z)
    const regex = new RegExp(`^(\\w+)\\((.+)${dim.rangeSeparator}(.+)\\)$`);
    const match = value.match(regex);
    if (!match) {
      throw new ParameterParseError(`subset dimension "${dim.name}" could not be parsed`);
    }
    const [, , minStr, maxStr] = match;
    const parsed = {};
    if (!dim) {
      throw new ParameterParseError(`unrecognized subset dimension "${dimName}"`);
    }
    if (result[dim.name]) {
      throw new ParameterParseError(`subset dimension "${dim.name}" was specified multiple times`);
    }
    if (dim.type === Number) {
      parsed.min = parseNumeric(dim, minStr, dim.min);
      parsed.max = parseNumeric(dim, maxStr, dim.max);
    } else if (dim.type === Date) {
      parsed.min = parseDate(dim, minStr);
      parsed.max = parseDate(dim, maxStr);
    } else {
      // Cannot be reached with current config.
      if (minStr !== dim.anyValue) parsed.min = minStr;
      if (maxStr !== dim.anyValue) parsed.max = maxStr;
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

/**
 * Given a set of parsed subset params, as returned by `parseSubsetParams`, returns an object
 * containing startTime and stopTime if applicable.
 *
 * @param {Object} values parsed, valid subset params, as returned by `parseSubsetParams`
 * @returns {Object} An object with startTime and stopTime fields if applicable
 */
function subsetParamsToTemporal(values) {
  const { time } = values;
  const temporal = {};
  if (time) {
    if (time.min) {
      temporal.startTime = time.min;
    }
    if (time.max) {
      temporal.stopTime = time.max;
    }
  }
  return temporal;
}

module.exports = {
  parseSubsetParams,
  subsetParamsToTemporal,
  subsetParamsToBbox,
  ParameterParseError,
};
