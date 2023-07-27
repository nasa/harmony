import camelCase from 'lodash.camelcase';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import * as fs from 'fs';
import { isInteger } from 'harmony-util/string';
import { WorkItemQueueType } from '../../../../app/util/queue/queue';

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
    envVars[camelCase(envName)] = parseInt(stringValue, 10);
  } else {
    envVars[camelCase(envName)] = stringValue;
  }
  process.env[envName] = stringValue;
}

const allEnv = { ...envDefaults, ...envOverrides, ...process.env };

for (const k of Object.keys(allEnv)) {
  makeConfigVar(k, allEnv[k]);
}

interface HarmonyEnv {
  harmonyClientId: string;
  logLevel: string;
  myPodName: string;
  port: number;
  workingDir: string;
  awsDefaultRegion: string;
  useLocalstack: boolean;
  localstackHost: string;
  workItemUpdateQueueUrl: string;
  largeWorkItemUpdateQueueUrl: string;
  largeWorkItemUpdateQueueMaxBatchSize: number;
  workItemUpdateQueueType: WorkItemQueueType;
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;
  workItemSchedulerQueueUrl: string;
  nodeEnv: string;
  serviceQueueBatchSizeCoefficient: number;
  useServiceQueues: boolean;
  maxErrorsForJob: number;
  cmrMaxPageSize: number;
  aggregateStacCatalogMaxPageSize: number;
  maxBatchInputs: number;
  maxBatchSizeInBytes: number;
}

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';
envVars.useServiceQueues = process.env.USE_SERVICE_QUEUES === 'true';

envVars.workItemUpdateQueueUrl = process.env.WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
envVars.largeWorkItemUpdateQueueUrl = process.env.LARGE_WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
envVars.workItemUpdateQueueType = process.env.WORK_ITEM_UPDATE_QUEUE_TYPE === 'large' ? WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;
envVars.workItemSchedulerQueueUrl = process.env.WORK_ITEM_SCHEDULER_QUEUE_URL?.replace('localstack', envVars.localstackHost);

export = envVars;
