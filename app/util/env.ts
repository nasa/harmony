import { camelCase } from 'change-case';
import * as dotenv from 'dotenv';
import * as winston from 'winston';

if (dotenv.config().error) {
  winston.warn('Did not read a .env file');
}

interface HarmonyEnv {
  logLevel: string;
  stagingBucket: string;
  maxSynchronousGranules: number;
  maxAsynchronousGranules: number;
  maxGranuleLimit: number;
  objectStoreType: string;
  awsDefaultRegion: string;
  sameRegionAccessRole: string;
  maxPostFields: number;
  maxPostFileSize: number;
  maxPostFileParts: number;
  nodeEnv: string;
  adminGroupId: string;
  harmonyClientId: string;
  isDevelopment: boolean;
  uploadBucket: string;
  cmrEndpoint: string;
  oauthHost: string;
  useLocalstack: boolean;
  callbackUrlRoot: string;
  syncRequestPollIntervalMs: number;
}

const envVars: HarmonyEnv = {} as HarmonyEnv;

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.isDevelopment = process.env.NODE_ENV === 'development';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'localStagingBucket';

/**
 * Add a symbol to module.exports with an appropriate value. The exported symbol will be in
 * camel case, e.g., `maxPostFileSize`. This approach has the drawback that these
 * config variables don't show up in VS Code autocomplete, but the reduction in repeated
 * boilerplate code is probably worth it.
 *
 * @param {string} envName The environment variable corresponding to the config variable in
 *   CONSTANT_CASE form
 * @param {*} defaultValue The value to use if the environment variable is not set. Only strings
 *   and integers are supported
 * @returns {void}
 */
function makeConfigVar(envName: string, defaultValue?: string | number): void {
  const envValue = process.env[envName];
  let value;

  if (!envValue) {
    value = defaultValue;
  } else if (typeof defaultValue === 'number') {
    value = parseInt(envValue, 10);
  } else {
    value = envValue;
  }

  envVars[camelCase(envName)] = value;
}

// create exported config variables
[
  // ENV_VAR, DEFAULT_VALUE
  ['LOG_LEVEL', 'debug'],
  ['STAGING_BUCKET', 'localStagingBucket'],
  ['MAX_SYNCHRONOUS_GRANULES', 1],
  ['MAX_ASYNCHRONOUS_GRANULES', 20],
  ['MAX_GRANULE_LIMIT', 2000],
  ['.OBJECT_STORE_TYPE', 's3'],
  ['AWS_DEFAULT_REGION', 'us-west-2'],
  ['SAME_REGION_ACCESS_ROLE'],
  // shapefile upload related configs
  ['MAX_POST_FIELDS', 100],
  ['MAX_POST_FILE_SIZE', 2000000000],
  ['MAX_POST_FILE_PARTS', 100],
  ['NODE_ENV', 'development'],
  ['ADMIN_GROUP_ID', null],
  ['CMR_ENDPOINT', 'https://cmr.uat.earthdata.nasa.gov'],
  ['OAUTH_HOST', 'https://uat.urs.earthdata.nasa.gov'],
  ['CALLBACK_URL_ROOT', null],
  ['SYNC_REQUEST_POLL_INTERVAL_MS', 100],
].forEach((value) => makeConfigVar.apply(this, value));

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.isDevelopment = process.env.NODE_ENV === 'development';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'localStagingBucket';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';

export = envVars;
