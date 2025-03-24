import { IsInt, Min } from 'class-validator';
import * as path from 'path';

import { HarmonyEnv } from '@harmony/util/env';

//
// env module
// Sets up the environment variables for the work failer using the base environment variables
// and some specific to the work failer
//

class FailerHarmonyEnv extends HarmonyEnv {

  @IsInt()
  @Min(1)
  workFailerPeriodSec: number;

  @IsInt()
  @Min(1)
  workFailerBatchSize: number;

  @IsInt()
  @Min(1)
  failableWorkAgeMinutes: number;

  @IsInt()
  @Min(-1)
  maxWorkItemsOnUpdateQueueFailer: number;

  @IsInt()
  @Min(1)
  defaultTimeoutSeconds: number;
}

const localPath = path.resolve(__dirname, '../../env-defaults');
const failerHarmonyEnvObj = new FailerHarmonyEnv(localPath);
failerHarmonyEnvObj.validate();

export default failerHarmonyEnvObj;
