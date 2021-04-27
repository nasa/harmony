/* eslint-disable guard-for-in */
import _ from 'lodash';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import * as fs from 'fs';
import { isInteger } from './string';

if (Object.prototype.hasOwnProperty.call(process.env, 'GDAL_DATA')) {
  winston.warn('Found a GDAL_DATA environment variable.  This is usually from an external GDAL '
    + 'installation and can interfere with CRS parsing in Harmony, so we will ignore it. '
    + 'If you need to override the GDAL_DATA location for Harmony, provide a GDAL_DATA key in '
    + 'your .env file.');
  delete process.env.GDAL_DATA;
}

let envDefaults = {};
try {
  envDefaults = dotenv.parse(fs.readFileSync('env-defaults'));
} catch (e) {
  winston.warn('Could not parse environment defaults from env-defaults file');
  winston.warn(e.message);
}

let envOverrides = {};
try {
  envOverrides = dotenv.parse(fs.readFileSync('.env'));
} catch (e) {
  winston.warn('Could not parse environment overrides from .env file');
  winston.warn(e.message);
}

const envVars: HarmonyEnv = {} as HarmonyEnv;

/**
 * Add a symbol to module.exports with an appropriate value. The exported symbol will be in
 * camel case, e.g., `maxPostFileSize`. This approach has the drawback that these
 * config variables don't show up in VS Code autocomplete, but the reduction in repeated
 * boilerplate code is probably worth it.
 *
 * @param envName - The environment variable corresponding to the config variable in
 *   CONSTANT_CASE form
 * @param defaultValue - The value to use if the environment variable is not set. Only strings
 *   and integers are supported
 */
function makeConfigVar(envName: string, defaultValue?: string): void {
  const stringValue = process.env[envName] || defaultValue;
  if (isInteger(stringValue)) {
    envVars[_.camelCase(envName)] = parseInt(stringValue, 10);
  } else {
    envVars[_.camelCase(envName)] = stringValue;
  }
  process.env[envName] = stringValue;
}

const envFromFiles = { ...envDefaults, ...envOverrides };

for (const k in envFromFiles) {
  makeConfigVar(k, envFromFiles[k]);
}

interface HarmonyEnv {
  adminGroupId: string;
  argoUrl: string;
  artifactBucket: string;
  awsDefaultRegion: string;
  builtInTaskPrefix: string;
  builtInTaskVersion: string;
  callbackUrlRoot: string;
  cmrEndpoint: string;
  cmrGranuleLocatorImagePullPolicy: string;
  cmrMaxPageSize: number;
  defaultArgoPodTimeoutSecs: number;
  defaultBatchSize: number;
  defaultImagePullPolicy: string;
  defaultParallelism: number;
  harmonyClientId: string;
  isDevelopment: boolean;
  jobReaperPeriodSec: number;
  localstackHost: string;
  logLevel: string;
  maxGranuleLimit: number;
  maxPostFields: number;
  maxPostFileParts: number;
  maxPostFileSize: number;
  maxSynchronousGranules: number;
  nodeEnv: string;
  oauthHost: string;
  oauthUid: string;
  objectStoreType: string;
  reapableJobAgeMinutes: number;
  sameRegionAccessRole: string;
  sharedSecretKey: string;
  stagingBucket: string;
  syncRequestPollIntervalMs: number;
  uploadBucket: string;
  useLocalstack: boolean;
}

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.isDevelopment = process.env.NODE_ENV === 'development';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'local-staging-bucket';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';

export = envVars;
