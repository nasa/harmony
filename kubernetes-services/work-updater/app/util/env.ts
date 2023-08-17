import { IsIn, IsInt, Min } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonyEnv, IHarmonyEnv, envOverrides, originalEnv, makeConfigVar, validateEnvironment, envVars } from '@harmony/util/env';
import { WorkItemQueueType } from '../../../../app/util/queue/queue';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work updater using the base environment variables
// and some specific to the updater
//

// read the local env-defaults from the top-level where the app is executed
const localPath = path.resolve(__dirname, '../../env-defaults');
const envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));

export interface IUpdaterHarmonyEnv extends IHarmonyEnv {
  largeWorkItemUpdateQueueMaxBatchSize: number;
  workItemUpdateQueueType: WorkItemQueueType;
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;
}

class UpdaterHarmonyEnv extends HarmonyEnv implements IUpdaterHarmonyEnv {

  @IsInt()
  @Min(1)
  largeWorkItemUpdateQueueMaxBatchSize: number;

  @IsIn([WorkItemQueueType.LARGE_ITEM_UPDATE, WorkItemQueueType.SMALL_ITEM_UPDATE])
  workItemUpdateQueueType: WorkItemQueueType;

  @IsInt()
  @Min(0)
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;
}

const allEnv = { ...envLocalDefaults, ...envOverrides };
const updaterEnvVars = _.cloneDeep(envVars) as IUpdaterHarmonyEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(updaterEnvVars, k, allEnv[k]);
}

// special case
updaterEnvVars.workItemUpdateQueueType = process.env.WORK_ITEM_UPDATE_QUEUE_TYPE === 'large' ? WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;

// validate the env vars
const updaterHarmonyEnvObj = new UpdaterHarmonyEnv(updaterEnvVars);
validateEnvironment(updaterHarmonyEnvObj);

export default updaterEnvVars;
