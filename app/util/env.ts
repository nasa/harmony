import _ from 'lodash';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import * as fs from 'fs';
import { isInteger, listToText } from './string';

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

const allEnv = { ...envDefaults, ...envOverrides, ...process.env };

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
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;
  workItemUpdateQueueProcessorCount: number;
  maxErrorsForJob: number;
  workItemRetryLimit: number;
  workItemSchedulerQueueUrl: string;
  workItemUpdateQueueUrl: string;
  largeWorkItemUpdateQueueUrl: string;
  largeWorkItemUpdateQueueMaxBatchSize: number;
  getWorkSampleRatio: number;
  putWorkSampleRatio: number;
  getMetricsSampleRatio: number;
  openTelemetryUrl: string;
  workFailerBatchSize: number;
  workReaperBatchSize: number;
  releaseVersion: string;
  serviceQueueUrls: { [key: string]: string };
  useServiceQueues: boolean;
}

// special cases

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
    // console.log(`Parsing ${k}=${value} as JSON`);
    try {
      const imageQueueUrls = JSON.parse(value);
      for (const imageQueueUrl of imageQueueUrls) {
        const [image, url] = imageQueueUrl.split(',');
        // console.log(`Parsed ${imageQueueUrl} as ${image}=${url}`);
        if (image && url) {
          // console.log(`Adding ${image}=${url} to serviceQueueUrls`);
          // replace 'localstack' with `env.localstackHost` to allow for harmony to be run in a
          // container
          envVars.serviceQueueUrls[image] = url.replace('localstack', envVars.localstackHost);
        } else {
          // console.log(`Could not parse ${imageQueueUrl} as image,url pair`);
        }
      }
    } catch (e) {
      // console.log(`Could not parse value ${value} for ${k} as JSON`);
    }
  }
}

// console.log(`SERVICE_QUEUE_URLS: ${JSON.stringify(envVars.serviceQueueUrls, null, 2)}`);

export = envVars;
