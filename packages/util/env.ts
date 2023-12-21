/* eslint-disable @typescript-eslint/dot-notation */
import _ from 'lodash';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { IsInt, IsNotEmpty, IsNumber, IsUrl, Matches, Max, Min, ValidateIf, ValidationError, validateSync } from 'class-validator';
import { isBoolean, isFloat, isInteger, parseBoolean } from './string';

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
  ],
});

//
// env module
// Sets up the environment variables used by more than one executable (the harmony server,
// the k8s services, etc.). Each executable can customize to add or override its own env vars
//

if (Object.prototype.hasOwnProperty.call(process.env, 'GDAL_DATA')) {
  logger.warn('Found a GDAL_DATA environment variable.  This is usually from an external GDAL '
    + 'installation and can interfere with CRS parsing in Harmony, so we will ignore it. '
    + 'If you need to override the GDAL_DATA location for Harmony, provide a GDAL_DATA key in '
    + 'your .env file.');
  delete process.env.GDAL_DATA;
}

// Save the original process.env so we can re-use it to override
export const originalEnv = _.cloneDeep(process.env);

/**
 * Parse a string env variable to a boolean or number if necessary.
 *
 * @param stringValue - The environment variable value as a string
 * @returns the parsed value
 */
function makeConfigVar(stringValue: string): number | string | boolean {
  if (isInteger(stringValue)) {
    return parseInt(stringValue, 10);
  } else if (isFloat(stringValue)) {
    return parseFloat(stringValue);
  } else if (isBoolean(stringValue)) {
    return parseBoolean(stringValue);
  } else {
    return stringValue;
  } 
}

/**
  Get any errors from validating the environment - leave out the env object itself
  from the output to avoid showing secrets.
  @param env - the HarmonyEnv instance, including constraints
  @returns An array of `ValidationError`s
*/
export function getValidationErrors(env: HarmonyEnv): ValidationError[] {
  return validateSync(env, { validationError: { target: false } });
}

/**
 * Get a map of image to queue URL.
 * @param env - (Record\<string, string\>) containing all environment config properties,
 * with snake-cased keys
 */
function queueUrlsMap(env: Record<string, string>): Record<string, string> {
  // process all environment variables ending in _QUEUE_URLS to add image/url pairs to
  // the `serviceQueueUrls` map
  const serviceQueueUrls = {};
  for (const k of Object.keys(env)) {
    if (/^.*_QUEUE_URLS$/.test(k)) {
      const value = env[k];
      try {
        const imageQueueUrls = JSON.parse(value);
        for (const imageQueueUrl of imageQueueUrls) {
          const [image, url] = imageQueueUrl.split(',');
          if (image && url) {
            // replace 'localstack' with `env.localstackHost` to allow for harmony to be run in a
            // container
            serviceQueueUrls[image] = url.replace('localstack', env.LOCALSTACK_HOST);
          }
        }
      } catch (e) {
        logger.error(`Could not parse value ${value} for ${k} as JSON`);
      }
    }
  }
  return serviceQueueUrls;
}

/**
 * Get special case environment variables for the HarmonyEnv.
 * @param env - (Record\<string, string\>) containing all environment config properties,
 * with snake-cased keys
 * @returns Partial\<HarmonyEnv\>
 */
function specialConfig(env: Record<string, string>): Partial<HarmonyEnv> {
  const localstackHost = env.LOCALSTACK_HOST;
  return {
    uploadBucket: env.UPLOAD_BUCKET || env.STAGING_BUCKET || 'local-staging-bucket',
    workItemUpdateQueueUrl: env.WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', localstackHost),
    largeWorkItemUpdateQueueUrl: env.LARGE_WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', localstackHost),
    workItemSchedulerQueueUrl: env.WORK_ITEM_SCHEDULER_QUEUE_URL?.replace('localstack', localstackHost),
    serviceQueueUrls: queueUrlsMap(env),
  };
}

/**
 * Returns an object (Record\<string, string\>) containing environment config properties,
 * with snake-cased keys. Loads the  properties from this module's env-defaults file, the env-defaults file
 * for the subclass (e.g. UpdaterHarmonyEnv), process.env, and optionally a .env file.
 * @param localEnvDefaultsPath - the path to the env-defaults file that
 * is specific to the HarmonyEnv subclass
 * @param dotEnvPath - path to the .env file
 * @returns all environment variables in snake case (Record\<string, string\>)
 */
function loadEnvFromFiles(localEnvDefaultsPath?: string, dotEnvPath?: string): Record<string, string> {
  let envOverrides = {};
  if (process.env.NODE_ENV !== 'test' ||
    dotEnvPath !== '../../.env') { // some tests provide a .env file
    try {
      envOverrides = dotenv.parse(fs.readFileSync(dotEnvPath));
    } catch (e) {
      logger.warn('Could not parse environment overrides from .env file');
      logger.warn(e.message);
    }
  }
  // read the local env-defaults
  let envLocalDefaults = {};
  if (localEnvDefaultsPath) {
    envLocalDefaults = dotenv.parse(fs.readFileSync(localEnvDefaultsPath));
  }
  // Read the env-defaults for this module (relative to this typescript file)
  const envDefaults = dotenv.parse(fs.readFileSync(path.resolve(__dirname, 'env-defaults')));
  return { ...envDefaults, ...envLocalDefaults, ...envOverrides, ...originalEnv };
}

// regexps for validations
const ipRegex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
const domainHostRegex = /^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
export const hostRegexWhitelist = { host_whitelist: [/localhost/, /localstack/, /harmony/, ipRegex, domainHostRegex] };
export const awsRegionRegex = /(us(-gov)?|ap|ca|cn|eu|sa)-(central|(north|south)?(east|west)?)-\d/;

export class HarmonyEnv {

  @IsNotEmpty()
  artifactBucket: string;

  @IsNotEmpty()
  uploadBucket: string;

  @Matches(awsRegionRegex)
  awsDefaultRegion: string;

  builtInTaskPrefix: string;

  builtInTaskVersion: string;

  @IsUrl(hostRegexWhitelist)
  callbackUrlRoot: string;

  @IsUrl(hostRegexWhitelist)
  cmrEndpoint: string;

  @IsInt()
  @Min(1)
  cmrMaxPageSize: number;

  @IsNotEmpty()
  databaseType: string;

  @IsNumber()
  @Min(0)
  defaultPodGracePeriodSecs: number;

  @IsNumber()
  @Min(1)
  defaultResultPageSize: number;

  @IsNotEmpty()
  clientId: string;

  @IsUrl(hostRegexWhitelist)
  largeWorkItemUpdateQueueUrl: string;

  @ValidateIf(obj => obj.useLocalstack === true)
  @IsNotEmpty()
  localstackHost: string;

  @IsNotEmpty()
  logLevel: string;

  @IsInt()
  @Min(0)
  maxGranuleLimit: number;

  @IsNotEmpty()
  nodeEnv: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  port: number;

  @IsInt()
  @Min(1)
  queueLongPollingWaitTimeSec: number;

  releaseVersion: string;

  @IsNotEmpty()
  sameRegionAccessRole: string;

  servicesYml: string;

  stagingBucket: string;

  serviceQueueUrls: { [key: string]: string; };

  useLocalstack: boolean;

  useServiceQueues: boolean;

  @IsUrl(hostRegexWhitelist)
  workItemSchedulerQueueUrl: string;

  @IsUrl(hostRegexWhitelist)
  workItemUpdateQueueUrl: string;

  /**
  * Validate a set of env vars.
  * @throws Error on constraing violation
  */
  validate(): void {
    if (process.env.SKIP_ENV_VALIDATION !== 'true') {
      const errors = getValidationErrors(this);
    
      if (errors.length > 0) {
        for (const err of errors) {
          logger.error(err);
        }
        throw (new Error('BAD ENVIRONMENT'));
      }
    }
  }

  /**
   * Get special case environment variables for the HarmonyEnv subclass.
   * @param _env - the map of all env variables loaded from files
   * @returns Partial\<HarmonyEnv\>, e.g. \{ cacheType : env.CACHE_TYPE || 'disk' \}
   */
  protected specialConfig(_env: Record<string, string>): Partial<HarmonyEnv> { 
    return {}; 
  }

  /**
   * Constructs the HarmonyEnv instance, for use in any Harmony component.
   * @param localEnvDefaultsPath - path to the env-defaults file of the component
   * @param dotEnvPath - path to the .env file
   */
  constructor(localEnvDefaultsPath?: string, dotEnvPath = '../../.env') {
    const env = loadEnvFromFiles(localEnvDefaultsPath, dotEnvPath); // { CONFIG_NAME: '0', ... }
    for (const k of Object.keys(env)) {
      this[_.camelCase(k)] = makeConfigVar(env[k]); // { configName: 0, ... }
      // for existing env vars this is redundant (but doesn't hurt), but this allows us
      // to add new env vars to the process as needed
      process.env[k] = env[k];
    }
    Object.assign(this, specialConfig(env), this.specialConfig(env));
  }
}

