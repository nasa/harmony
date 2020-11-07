import _ from 'lodash';
import * as dotenv from 'dotenv';
import * as winston from 'winston';

console.log(process.env);
if (dotenv.config().error) {
  winston.warn('Did not read a .env file');
}
console.log(process.env);

interface HarmonyEnv {
  logLevel: string;
  stagingBucket: string;
  artifactBucket: string;
  maxSynchronousGranules: number;
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
  argoUrl: string;
  cmrEndpoint: string;
  oauthHost: string;
  useLocalstack: boolean;
  localstackHost: string;
  callbackUrlRoot: string;
  syncRequestPollIntervalMs: number;
  defaultImagePullPolicy: string;
  sharedSecretKey: string;
  defaultBatchSize: number;
  defaultParallelism: number;
  jobReaperPeriodSec: number;
  reapableJobAgeMinutes: number;
  defaultArgoPodTimeoutSecs: number;
  builtInTaskPrefix: string;
  builtInTaskVersion: string;
  ursUrl: string;
  edlClientId: string;
  edlRedirectUri: string;
  fallbackAuthnEnabled: boolean;
}

const envVars: HarmonyEnv = {} as HarmonyEnv;

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

  console.log(envName, defaultValue, envValue);

  if (!envValue) {
    value = defaultValue;
  } else if (typeof defaultValue === 'number') {
    value = parseInt(envValue, 10);
  } else {
    value = envValue;
  }

  envVars[_.camelCase(envName)] = value;
}

// create exported config variables
[
  // ENV_VAR, DEFAULT_VALUE
  ['ARGO_URL', 'http://localhost:4276'],
  ['LOG_LEVEL', 'debug'],
  ['STAGING_BUCKET', 'local-staging-bucket'],
  ['ARTIFACT_BUCKET', 'local-artifact-bucket'],
  ['MAX_SYNCHRONOUS_GRANULES', 1],
  ['MAX_GRANULE_LIMIT', 350],
  ['OBJECT_STORE_TYPE', 's3'],
  ['AWS_DEFAULT_REGION', 'us-west-2'],
  ['SAME_REGION_ACCESS_ROLE'],
  ['JOB_REAPER_PERIOD_SEC', 360],
  ['REAPABLE_JOB_AGE_MINUTES', 60],
  ['LOCALSTACK_HOST', 'localhost'],
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
  ['DEFAULT_BATCH_SIZE', 2000],
  ['DEFAULT_IMAGE_PULL_POLICY', 'Always'],
  ['DEFAULT_PARALLELISM', 2],
  ['SHARED_SECRET_KEY', null],
  ['DEFAULT_ARGO_POD_TIMEOUT_SECS', 14400],
  ['BUILT_IN_TASK_PREFIX', ''],
  ['BUILT_IN_TASK_VERSION', 'latest'],
  ['URS_URL', 'https://uat.urs.earthdata.nasa.gov'],
  ['EDL_CLIENT_ID', null],
  ['EDL_REDIRECT_URI', 'http://localhost:3000/oauth2/redirect'],
].forEach((value) => makeConfigVar.apply(this, value));

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.isDevelopment = process.env.NODE_ENV === 'development';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'local-staging-bucket';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';
envVars.fallbackAuthnEnabled = process.env.FALLBACK_AUTHN_ENABLED === 'true';

export = envVars;
