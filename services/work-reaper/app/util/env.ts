import { IsInt, Min } from 'class-validator';
import * as path from 'path';
import { HarmonyEnv } from '@harmony/util/env';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work reaper using the base environment variables
// and some specific to the reaper
//

class ReaperHarmonyEnv extends HarmonyEnv {

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

const localPath = path.resolve(__dirname, '../../env-defaults');
const reaperHarmonyEnvObj = new ReaperHarmonyEnv(localPath);
reaperHarmonyEnvObj.validate();

export default reaperHarmonyEnvObj;
