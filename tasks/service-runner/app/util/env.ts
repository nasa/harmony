import { IsInt, IsNotEmpty, Length, Max, Min, ValidateIf, validateSync } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { envDefaults, envOverrides, HarmonyEnv, IHarmonyEnv, makeConfigVar } from '@harmony/util/env';
import { env } from '@harmony/util';

//
// env module
// Sets up the environment variables for the service runner using the base environment variables
// and some specific to the service runner
//

// read the local env-defaults from the top-level where the app is executed
let envLocalDefaults = {};
try {
  const localPath = path.resolve(__dirname, '../../env-defaults');
  winston.debug(`localPath = ${localPath}`);
  envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));
} catch (e) {
  winston.warn('Could not parse environment defaults from env-defaults file');
  winston.warn(e.message);
}

interface IHarmonyServiceEnv extends IHarmonyEnv {
  artifactBucket: string;
  backendHost: string;
  backendPort: number;
  harmonyClientId: string;
  harmonyService: string;
  invocationArgs: string;
  maxPutWorkRetries: number;
  myPodName: string;
  port: number;
  sharedSecretKey: string;
  workerPort: number;
  workerTimeout: number;
  workingDir: string;
}

class HarmonyServiceEnv extends HarmonyEnv implements IHarmonyServiceEnv {

  @IsNotEmpty()
  artifactBucket: string;

  @IsNotEmpty()
  backendHost: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  backendPort: number;

  @Length(128)
  cookieSecret: string;

  @IsNotEmpty()
  harmonyClientId: string;

  @IsNotEmpty()
  harmonyService: string;

  @ValidateIf(o => ! /query-cmr/.test(o.harmonyService))
  @IsNotEmpty()
  invocationArgs: string;

  @IsInt()
  @Min(0)
  maxPutWorkRetries: number;

  @IsNotEmpty()
  myPodName: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  workerPort: number;

  @IsInt()
  workerTimeout: number;

  @IsNotEmpty()
  workingDir: string;

  @IsNotEmpty()
  sharedSecretKey: string;

}

const allEnv = { ...envDefaults, ...envOverrides, ...envLocalDefaults, ...process.env };
const envVars: IHarmonyServiceEnv = env as IHarmonyServiceEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(envVars, k, allEnv[k]);
}

// special case
envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';

// validate the env vars
const harmonyServiceEnvObj = new HarmonyServiceEnv(envVars);
const errors = validateSync(harmonyServiceEnvObj,  { validationError: { target: false } });
if (errors.length > 0) {
  for (const err of errors) {
    winston.error(err);
  }
  throw (new Error('BAD ENVIRONMENT'));
}

export default envVars;
