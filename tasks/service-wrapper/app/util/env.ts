import camelCase from 'lodash.camelcase';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import * as fs from 'fs';
import { isInteger } from './string';

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

winston.warn(`WORKING_DIR=${process.env.WORKING_DIR}`);
winston.warn(`INVOCATION_ARGS=${process.env.INVOCATION_ARGS}`);

const allEnv = { ...envDefaults, ...envOverrides, ...process.env };

for (const k of Object.keys(allEnv)) {
  makeConfigVar(k, allEnv[k]);
}

interface HarmonyEnv {
  harmonyClientId: string;
  harmonyService: string;
  invocationArgs: string;
  logLevel: string;
  port: number;
  pullUrl: string;
  responseUrl: string;
  scriptFile: string;
  scriptDir: string;
  uploadBucket: string;
  useLocalstack: boolean;
  workingDir: string;
}

// special cases

envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'local-staging-bucket';
envVars.useLocalstack = process.env.USE_LOCALSTACK === 'true';
envVars.port = 1234;

export = envVars;
