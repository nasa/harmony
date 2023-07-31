import { IsInt, IsNotEmpty, Max, Min, validateSync } from 'class-validator';
import * as winston from 'winston';
import { HarmonyEnv, IHarmonyEnv } from '@harmony/util/env';
import { env } from '@harmony/util';

//
// env module
// Sets up the environment variables for the service runner using the base environment variables
// and some specific to the service runner
//

interface IHarmonyServiceEnv extends IHarmonyEnv {
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
}

class HarmonyServiceEnv extends HarmonyEnv implements IHarmonyServiceEnv {
  @IsNotEmpty()
    backendHost: string;

  @IsInt()
  @Min(0)
  @Max(65535)
    backendPort: number;

  @IsNotEmpty()
    harmonyClientId: string;

  @IsNotEmpty()
    harmonyService: string;

  @IsNotEmpty()
    invocationArgs: string;

  logLevel: string;

  @IsNotEmpty()
    myPodName: string;

  @IsInt()
  @Min(0)
  @Max(65535)
    port: number;

  @IsInt()
  @Min(0)
  @Max(65535)
    workerPort: number;

  @IsInt()
    workerTimeout: number;

  @IsNotEmpty()
    workingDir: string;

  @IsInt()
  @Min(0)
    maxPutWorkRetries: number;

  @IsNotEmpty()
    artifactBucket: string;
}

const envVars: IHarmonyServiceEnv = env as IHarmonyServiceEnv;

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
