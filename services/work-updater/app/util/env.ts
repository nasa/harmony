import { IsIn, IsInt, Min } from 'class-validator';
import * as path from 'path';
import { HarmonyEnv } from '@harmony/util/env';
import { WorkItemQueueType } from '@harmony/util/queue';
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
  workItemUpdateQueueType: WorkItemQueueType;

  @IsInt()
  @Min(0)
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;

  /**
   * Returns the special env variable cases for the UpdaterHarmonyEnv
   * (with keys in camel case).
   * @param env - the map of all env variables loaded from files
   * @returns Partial\<UpdaterHarmonyEnv\>
   */
  specialConfig(env: Record<string, string>): Partial<UpdaterHarmonyEnv> {
    return {
      workItemUpdateQueueType : env.WORK_ITEM_UPDATE_QUEUE_TYPE === 'large' ?
        WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE,
    };
  }
}

const localPath = path.resolve(__dirname, '../../env-defaults');

// validate the env vars
const updaterHarmonyEnvObj = new UpdaterHarmonyEnv(localPath);
updaterHarmonyEnvObj.validate();

export default updaterHarmonyEnvObj;
