import { IsInt, Min } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonyEnv, IHarmonyEnv, envOverrides, makeConfigVar, validateEnvironment, envVars } from '@harmony/util/env';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work reaper using the base environment variables
// and some specific to the reaper
//

// read the local env-defaults
const localPath = path.resolve(__dirname, '../../env-defaults');
const envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));

export interface IReaperHarmonyEnv extends IHarmonyEnv {
  workReaperPeriodSec: number;
  workReaperBatchSize: number;
  reapableWorkAgeMinutes: number;
}

class ReaperHarmonyEnv extends HarmonyEnv implements IReaperHarmonyEnv {

  @IsInt()
  @Min(1)
  workReaperPeriodSec: number;

  @IsInt()
  @Min(1)
  workReaperBatchSize: number;

  @IsInt()
  @Min(1)
  reapableWorkAgeMinutes: number;
}

const allEnv = { ...envLocalDefaults, ...envOverrides };
const reaperEnvVars = _.cloneDeep(envVars) as IReaperHarmonyEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(reaperEnvVars, k, allEnv[k]);
}

// validate the env vars
const reaperHarmonyEnvObj = new ReaperHarmonyEnv(reaperEnvVars);
validateEnvironment(reaperHarmonyEnvObj);

export default reaperEnvVars;
