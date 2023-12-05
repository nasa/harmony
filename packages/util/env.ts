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
const ipRegex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
const domainHostRegex = /^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
export const hostRegexWhitelist = { host_whitelist: [/localhost/, /localstack/, /harmony/, ipRegex, domainHostRegex] };
export const awsRegionRegex = /(us(-gov)?|ap|ca|cn|eu|sa)-(central|(north|south)?(east|west)?)-\d/;
const gdalWarning = 'Found a GDAL_DATA environment variable.  This is usually from an external GDAL '
+ 'installation and can interfere with CRS parsing in Harmony, so we will ignore it. '
+ 'If you need to override the GDAL_DATA location for Harmony, provide a GDAL_DATA key in '
+ 'your .env file.';

/**
 * Parse a string env variable to a boolean or number if necessary. This approach has the drawback that these
 * config variables don't show up in VS Code autocomplete, but the reduction in repeated
 * boilerplate code is probably worth it.
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
  @param env - the object representing the env vars, including constraints
  @returns An array of `ValidationError`s
*/
export function getValidationErrors(env: HarmonyEnv): ValidationError[] {
  return validateSync(env, { validationError: { target: false } });
}

/**
 * Adds a map of image to queue URL to the env object.
 * @param envVars - the HarmonyEnv to add to
 */
function setQueueUrls(envVars: Partial<HarmonyEnv>): void {
  // process all environment variables ending in _QUEUE_URLS to add image/url pairs to
  // the `serviceQueueUrls` map
  envVars.serviceQueueUrls = {};
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
        logger.error(`Could not parse value ${value} for ${k} as JSON`);
      }
    }
  }
}

/**
 * Adds special case environment variables to the HarmonyEnv.
 * @param envVars - the HarmonyEnv to add to
 */
function setSpecialCases(envVars: Partial<HarmonyEnv>): void {
  envVars.databaseType = process.env.DATABASE_TYPE || 'postgres';
  envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
  envVars.uploadBucket = process.env.UPLOAD_BUCKET || process.env.STAGING_BUCKET || 'local-staging-bucket';
  envVars.useLocalstack = !! envVars.useLocalstack;
  envVars.useServiceQueues = !! envVars.useServiceQueues;
  envVars.workItemUpdateQueueUrl = process.env.WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
  envVars.largeWorkItemUpdateQueueUrl = process.env.LARGE_WORK_ITEM_UPDATE_QUEUE_URL?.replace('localstack', envVars.localstackHost);
  envVars.workItemSchedulerQueueUrl = process.env.WORK_ITEM_SCHEDULER_QUEUE_URL?.replace('localstack', envVars.localstackHost);
  setQueueUrls(envVars);
}

/**
 * Builds the HarmonyEnv from this module's env-defaults, the env-defaults
 * for a subclass (e.g. UpdaterHarmonyEnv), process.env, and optionally .env.
 * @param localEnvDefaultsPath - the path to the env-defaults file that
 * is specific to the HarmonyEnv subclass 
 * @returns a HarmonyEnv containing all necessary environment variables
 */
function buildEnv(localEnvDefaultsPath: string): HarmonyEnv {
  const env: Partial<HarmonyEnv> = {};
  if (Object.prototype.hasOwnProperty.call(process.env, 'GDAL_DATA')) {
    logger.warn(gdalWarning);
    delete process.env.GDAL_DATA;
  }
  // Save the original process.env so we can re-use it to override
  const originalEnv = _.cloneDeep(process.env);
  // Read the env-defaults for this module (relative to this typescript file)
  const envDefaults = dotenv.parse(fs.readFileSync(path.resolve(__dirname, 'env-defaults')));
  let envOverrides = {};
  if (process.env.NODE_ENV !== 'test') {
    try {
      envOverrides = dotenv.parse(fs.readFileSync('../../.env'));
    } catch (e) {
      logger.warn('Could not parse environment overrides from .env file');
      logger.warn(e.message);
    }
  }
  // read the local env-defaults
  const envLocalDefaults = dotenv.parse(fs.readFileSync(localEnvDefaultsPath));
  const allEnv = { ...envLocalDefaults, ...envDefaults, ...envOverrides, ...originalEnv };
  for (const k of Object.keys(allEnv)) {
    env[_.camelCase(k)] = makeConfigVar(allEnv[k]);
  }
  setSpecialCases(env);
  for (const k of Object.keys(allEnv)) {
    // for existing env vars this is redundant (but doesn't hurt), but this allows us
    // to add new env vars to the process as needed
    process.env[k] = allEnv[k];
  }
  return env as HarmonyEnv;
}

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
  harmonyClientId: string;

  @IsUrl(hostRegexWhitelist)
  largeWorkItemUpdateQueueUrl: string;

  @ValidateIf(obj => obj.useLocalStack === true)
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
  * @param env - the object representing the env vars, including constraints
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

  constructor(localPath: string) {
    const env = buildEnv(localPath);
    for (const key of Object.keys(env)) {
      this[key] = env[key];
    }
  }
}
