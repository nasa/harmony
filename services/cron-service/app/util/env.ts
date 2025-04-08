import { IsInt, Min } from 'class-validator';
import * as path from 'path';

import { HarmonyEnv } from '../../../../packages/util/env';
import { IsCrontab } from './cron-validation';

//
// env module
// Sets up the environment variables for cron services using the base environment variables
// and some specific to the cron services
//

class CronServiceHarmonyEnv extends HarmonyEnv {

  // Begin work reaper variables
  @IsCrontab()
  workReaperCron: string;

  @IsInt()
  @Min(1)
  workReaperBatchSize: number;

  @IsInt()
  @Min(1)
  reapableWorkAgeMinutes: number;
  // End work reaper variables


  // Begin restart prometheus variables
  @IsCrontab()
  restartPrometheusCron: string;
  // End restart prometheus variables

  // Begin user work update variables
  @IsCrontab()
  userWorkUpdaterCron: string;

  @IsInt()
  @Min(1)
  userWorkExpirationMinutes: number;
  // End user work update variables
}

const localPath = path.resolve(__dirname, '../../env-defaults');

// validate the env vars
const cronServiceHarmonyEnvObj = new CronServiceHarmonyEnv(localPath);
cronServiceHarmonyEnvObj.validate();

export default cronServiceHarmonyEnvObj;
