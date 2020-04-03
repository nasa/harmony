const { camelCase } = require('change-case');

/**
 * Add a symbol to module.exports with an appropriate value. This has the drawback that these
 * config variables don't show up in VS Code autocomplete, but the reduction in repeated
 * boilerplate code is probably worth it.
 *
 * @param {string} envName The environment variable corresponding to the config variable in
 *   CONSTANT_CASE form
 * @param {*} defaultValue The value to use if the environment variable is not set. Only strings
 *   and integers are supported
 * @returns {void}
 */
function makeConfigVar(envName, defaultValue) {
  const envValue = process.env[envName];
  let value;

  if (!envValue) {
    value = defaultValue;
  } else if (typeof defaultValue === 'number') {
    value = parseInt(envValue, 10);
  } else {
    value = envValue;
  }

  module.exports[camelCase(envName)] = value;
}

// create exported config variables
[
  // ENV_VAR, DEFAULT_VALUE
  ['LOG_LEVEL', 'debug'],
  ['STAGING_BUCKET', 'localStagingBucket'],
  ['MAX_SYNCHRONOUS_GRANULES', 1],
  ['MAX_ASYNCHRONOUS_GRANULES', 20],
  ['.OBJECT_STORE_TYPE', 's3'],
  // shapefile upload related configs
  ['MAX_POST_FIELDS', 100],
  ['MAX_POST_FILE_SIZE', 2000000000],
  ['MAX_POST_FILE_PARTS', 100],
].forEach((value) => makeConfigVar.apply(this, value));


// special cases

module.exports.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
module.exports.isDevelopment = process.env.NODE_ENV === 'development';
module.exports.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'localStagingBucket';
