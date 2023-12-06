import { IsInt, IsNotEmpty, IsNumber, Min } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonyEnv, IHarmonyEnv, envOverrides, originalEnv, makeConfigVar, validateEnvironment, envVars } from '@harmony/util/env';
import _ from 'lodash';
//
// env module
// Sets up the environment variables for the work scheduler using the base environment variables
// and some specific to the work scheduler
//

// read the local env-defaults
const localPath = path.resolve(__dirname, '../../env-defaults');
const envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));

interface IHarmonyWorkSchedulerEnv extends IHarmonyEnv {
  serviceQueueBatchSizeCoefficient: number;
  workingDir: string;
  workItemSchedulerQueueMaxBatchSize: number;
  workItemSchedulerQueueMaxGetMessageRequests: number;
  workItemSchedulerBatchSize: number;
}

class HarmonyWorkSchedulerEnv extends HarmonyEnv implements IHarmonyWorkSchedulerEnv {

  @IsNumber()
  @Min(0)
  serviceQueueBatchSizeCoefficient: number;

  @IsNotEmpty()
  workingDir: string;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxBatchSize: number;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxGetMessageRequests: number;

  @IsInt()
  @Min(1)
  workItemSchedulerBatchSize: number;
}

const allEnv = { ...envLocalDefaults, ...envOverrides };
const schedulerEnvVars: IHarmonyWorkSchedulerEnv = _.cloneDeep(envVars) as IHarmonyWorkSchedulerEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(schedulerEnvVars, k, allEnv[k]);
}

// special case
schedulerEnvVars.harmonyClientId = originalEnv.CLIENT_ID || 'harmony-unknown';

// validate the env vars
const envObj = new HarmonyWorkSchedulerEnv(schedulerEnvVars);
validateEnvironment(envObj);

export default schedulerEnvVars;
