import _ from 'lodash';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { isInteger, listToText } from './string';

if (Object.prototype.hasOwnProperty.call(process.env, 'GDAL_DATA')) {
  winston.warn('Found a GDAL_DATA environment variable.  This is usually from an external GDAL '
    + 'installation and can interfere with CRS parsing in Harmony, so we will ignore it. '
    + 'If you need to override the GDAL_DATA location for Harmony, provide a GDAL_DATA key in '
    + 'your .env file.');
  delete process.env.GDAL_DATA;
}

// Read the env-defaults for this module (relative to this typescript file)
let envDefaults = {};
try {
  envDefaults = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../env-defaults')));
} catch (e) {
  winston.warn('Could not parse environment defaults from env-defaults file');
  winston.warn(e.message);
}

// read the local env-defaults from the top-level where the app is executed
let envLocalDefaults = {};
try {
  envLocalDefaults = dotenv.parse(fs.readFileSync('env-defaults'));
} catch (e) {
  winston.warn('Could not parse environment defaults from env-defaults file');
  winston.warn(e.message);
}

let envOverrides = {};
if (process.env.NODE_ENV !== 'test') {
  try {
    envOverrides = dotenv.parse(fs.readFileSync('.env'));
  } catch (e) {
    winston.warn('Could not parse environment overrides from .env file');
    winston.warn(e.message);
  }
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

const allEnv = { ...envDefaults, ...envLocalDefaults, ...envOverrides, ...process.env };

for (const k of Object.keys(allEnv)) {
  makeConfigVar(k, allEnv[k]);
}

const requiredVars = ['SHARED_SECRET_KEY'];

const missingVars = requiredVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  throw new Error(`Configuration error: You must set ${listToText(missingVars)} in the environment`);
}

interface HarmonyEnv {
  adminGroupId: string;
  aggregateStacCatalogMaxPageSize: number;
  artifactBucket: string;
  awsDefaultRegion: string;
  builtInTaskPrefix: string;
  builtInTaskVersion: string;
  callbackUrlRoot: string;
  cmrEndpoint: string;
  metricsEndpoint: string;
  metricsIndex: string;
  cmrMaxPageSize: number;
  databaseType: string;
  defaultPodGracePeriodSecs: number;
  defaultJobListPageSize: number;
  defaultParallelism: number;
  defaultResultPageSize: number;
  failableWorkAgeMinutes: number;
  harmonyClientId: string;
  localstackHost: string;
  logLevel: string;
  logViewerGroupId: string;
  maxGranuleLimit: number;
  maxPageSize: number;
  maxBatchInputs: number;
  maxBatchSizeInBytes: number;
  maxPostFields: number;
  maxPostFileParts: number;
  maxPostFileSize: number;
  maxSynchronousGranules: number;
  nodeEnv: string;
  oauthClientId: string;
  oauthHost: string;
  oauthPassword: string;
  oauthUid: string;
  objectStoreType: string;
  previewThreshold: number;
  queueLongPollingWaitTimeSec: number
  reapableWorkAgeMinutes: number;
  sameRegionAccessRole: string;
  servicesYml: string;
  sharedSecretKey: string;
  stagingBucket: string;
  syncRequestPollIntervalMs: number;
  uploadBucket: string;
  useLocalstack: boolean;
  workFailerPeriodSec: number;
  workReaperPeriodSec: number;
  maxErrorsForJob: number;
  workItemRetryLimit: number;
  workItemSchedulerQueueUrl: string;
  workItemUpdateQueueUrl: string;
  largeWorkItemUpdateQueueUrl: string;
  getWorkSampleRatio: number;
  putWorkSampleRatio: number;
  getMetricsSampleRatio: number;
  openTelemetryUrl: string;
  workFailerBatchSize: number;
  workReaperBatchSize: number;
  releaseVersion: string;
  serviceQueueUrls: { [key: string]: string };
  useServiceQueues: boolean;

  // Allow extension of this interface with new properties. This should only be used for special
  // properties that cannot be captured explicitly like the above properties.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [propName: string]: any;
}

// special cases

envVars.databaseType = process.env.DATABASE_TYPE || 'postgres';
envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'local-staging-bucket';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';
envVars.useServiceQueues = process.env.USE_SERVICE_QUEUES === 'true';
envVars.workItemUpdateQueueUrl = process.env.WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
envVars.largeWorkItemUpdateQueueUrl = process.env.LARGE_WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
envVars.workItemSchedulerQueueUrl = process.env.WORK_ITEM_SCHEDULER_QUEUE_URL?.replace('localstack', envVars.localstackHost);

envVars.serviceQueueUrls = {};
// process all environment variables ending in _QUEUE_URLS to add image/url pairs to
// the `serviceQueueUrls` map
for (const k of Object.keys(process.env)) {
  if (/^.*_QUEUE_URLS$/.test(k)) {
    const value = process.env[k];
    try {
      const imageQueueUrls = JSON.parse(value);
      for (const imageQueueUrl of imageQueueUrls) {
        const [image, url] = imageQueueUrl.split(',');
        if (image && url) {
          // replace 'localstack' with `env.localstackHost` to allow for harmony to be run in a
          // container
          envVars.serviceQueueUrls[image] = url.replace('localstack', envVars.localstackHost);
        }
      }
    } catch (e) {
      winston.error(`Could not parse value ${value} for ${k} as JSON`);
    }
  }
}

// validate - this is ugly, but is the best way to do this until we update to TypeScript 5.x and
// can use decorators
const requiredFields = [
  'adminGroupId',
  'aggregateStacCatalogMaxPageSize',
  'artifactBucket',
  'awsDefaultRegion',
  'callbackUrlRoot',
  'cmrEndpoint',
  'cmrMaxPageSize',
  'databaseType',
  'defaultJobListPageSize',
  'defaultPodGracePeriodSecs',
  'defaultResultPageSize',
  'failableWorkAgeMinutes',
  'getMetricsSampleRatio',
  'getWorkSampleRatio',
  'harmonyClientId',
  'largeWorkItemUpdateQueueUrl',
  'localstackHost',
  'logLevel',
  'logViewerGroupId',
  'maxBatchInputs',
  'maxBatchSizeInBytes',
  'maxErrorsForJob',
  'maxGranuleLimit',
  'maxPageSize',
  'maxPostFields',
  'maxPostFileParts',
  'maxPostFileSize',
  'maxSynchronousGranules',
  'nodeEnv',
  'oauthClientId',
  'oauthHost',
  'oauthPassword',
  'oauthUid',
  'objectStoreType',
  'openTelemetryUrl',
  'previewThreshold',
  'putWorkSampleRatio',
  'queueLongPollingWaitTimeSec',
  'reapableWorkAgeMinutes',
  'releaseVersion',
  'sameRegionAccessRole',
  'sharedSecretKey',
  'stagingBucket',
  'syncRequestPollIntervalMs',
  'uploadBucket',
  'useLocalstack',
  'workFailerBatchSize',
  'workFailerPeriodSec',
  'workItemRetryLimit',
  'workItemSchedulerQueueUrl',
  'workItemUpdateQueueUrl',
  'workReaperBatchSize',
  'workReaperPeriodSec',
];

const missingFields = requiredFields.filter((f) => !envVars[f]);
if (missingFields.length > 0) {
  throw new Error(`Configuration error: You must set ${listToText(missingFields)} in the environment`);
}


// TODO move this into a sub-project and add specializations for harmony and
// each service


export default envVars;
