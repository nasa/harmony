import { IsIn, IsInt, Min } from 'class-validator';
import * as path from 'path';
import { HarmonyEnv } from '@harmony/util/env';
import { WorkItemQueueType } from '../../../harmony/app/util/queue/queue';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work updater using the base environment variables
// and some specific to the updater
//

class UpdaterHarmonyEnv extends HarmonyEnv {

  @IsInt()
  @Min(1)
  largeWorkItemUpdateQueueMaxBatchSize: number;

  @IsIn([WorkItemQueueType.LARGE_ITEM_UPDATE, WorkItemQueueType.SMALL_ITEM_UPDATE])
  workItemUpdateQueueType: WorkItemQueueType | string;

  @IsInt()
  @Min(0)
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;

  /**
   * Handles cases where setting the env variable requires more
   * than just reading the value straight from the file.
   */
  setSpecialCases(env: UpdaterHarmonyEnv): void {
    env.workItemUpdateQueueType = env.workItemUpdateQueueType === 'large' ?
      WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;
  }
}

const localPath = path.resolve(__dirname, '../../env-defaults');

// validate the env vars
const updaterHarmonyEnvObj = new UpdaterHarmonyEnv(localPath);
updaterHarmonyEnvObj.validate();

export default updaterHarmonyEnvObj;
