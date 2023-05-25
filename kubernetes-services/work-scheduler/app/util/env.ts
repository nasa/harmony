import camelCase from 'lodash.camelcase';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import * as fs from 'fs';
import { isInteger } from '../../../../app/util/string';

let envDefaults = {};
let localDefaults = {};
try {
  envDefaults = dotenv.parse(fs.readFileSync('../../env-defaults'));
  localDefaults = dotenv.parse(fs.readFileSync('env-defaults'));
} catch (e) {
  winston.warn('Could not parse environment defaults from env-defaults file');
  winston.warn(e.message);
}

envDefaults = { ...envDefaults, ...localDefaults };

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
  backendHost: string;
  backendPort: number;
  harmonyClientId: string;
  harmonyService: string;
  invocationArgs: string;
  logLevel: string;
  myPodName: string;
  port: number;
  workerPort: number;
  workerTimeout: number;
  workingDir: string;
  maxPutWorkRetries: number;
  artifactBucket: string;
  awsDefaultRegion: string;
  useLocalstack: boolean;
  localstackHost: string;
  serviceQueueUrls: { [key: string]: string };
  useServiceQueues: boolean;
  workItemSchedulerQueueUrl: string;
  maxGranuleLimit: number;
  nodeEnv: string;
  schedulerQueueBatchSize: number;
}

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';
envVars.useServiceQueues = process.env.USE_SERVICE_QUEUES === 'true';
envVars.workItemSchedulerQueueUrl = process.env.WORK_ITEM_SCHEDULER_QUEUE_URL.replace('localstack', envVars.localstackHost);

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
      winston.warn(`Could not parse value ${value} for ${k} as JSON`);
    }
  }
}

export = envVars;
