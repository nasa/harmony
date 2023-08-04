import { IsInt, IsNotEmpty, IsNumber, Min, validateSync } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { HarmonyEnv, IHarmonyEnv, envDefaults, envOverrides, makeConfigVar } from '@harmony/util/env';
import { env } from '@harmony/util';
import _ from 'lodash';
//
// env module
// Sets up the environment variables for the work scheduler using the base environment variables
// and some specific to the work scheduler
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

interface IHarmonyWorkSchedulerEnv extends IHarmonyEnv {
  serviceQueueBatchSizeCoefficient: number;
  workingDir: string;
  workItemSchedulerQueueMaxBatchSize: number;
  workItemSchedulerQueueMaxGetMessageRequests: number;
}

class HarmonyWorkSchedulerEnv extends HarmonyEnv implements IHarmonyWorkSchedulerEnv {

  @IsNumber()
  @Min(1)
  serviceQueueBatchSizeCoefficient: number;

  @IsNotEmpty()
  workingDir: string;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxBatchSize: number;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxGetMessageRequests: number;
}

const allEnv = { ...envDefaults, ...envLocalDefaults, ...envOverrides, ...process.env };
const envVars: IHarmonyWorkSchedulerEnv = _.cloneDeep(env) as IHarmonyWorkSchedulerEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(envVars, k, allEnv[k]);
}

// special case
envVars.harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';

// validate the env vars
const envObj = new HarmonyWorkSchedulerEnv(envVars);
const errors = validateSync(envObj,  { validationError: { target: false } });
if (errors.length > 0) {
  for (const err of errors) {
    winston.error(err);
  }
  throw (new Error('BAD ENVIRONMENT'));
}

export default envVars;
