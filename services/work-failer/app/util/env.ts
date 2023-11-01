import { IsInt, Min } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonyEnv, IHarmonyEnv, envOverrides, makeConfigVar, validateEnvironment, envVars } from '@harmony/util/env';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work failer using the base environment variables
// and some specific to the work failer
//

// read the local env-defaults
const localPath = path.resolve(__dirname, '../../env-defaults');
const envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));

export interface IFailerHarmonyEnv extends IHarmonyEnv {
  workFailerPeriodSec: number;
  workFailerBatchSize: number;
  failableWorkAgeMinutes: number;
}

class FailerHarmonyEnv extends HarmonyEnv implements IFailerHarmonyEnv {

  @IsInt()
  @Min(1)
  workFailerPeriodSec: number;

  @IsInt()
  @Min(1)
  workFailerBatchSize: number;

  @IsInt()
  @Min(1)
  failableWorkAgeMinutes: number;
}

const allEnv = { ...envLocalDefaults, ...envOverrides };
const failerEnvVars = _.cloneDeep(envVars) as IFailerHarmonyEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(failerEnvVars, k, allEnv[k]);
}

// validate the env vars
const failerHarmonyEnvObj = new FailerHarmonyEnv(failerEnvVars);
validateEnvironment(failerHarmonyEnvObj);

export default failerEnvVars;
