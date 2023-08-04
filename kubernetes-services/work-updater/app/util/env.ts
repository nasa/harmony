import { IsIn, IsInt, Min, validateSync } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { HarmonyEnv, IHarmonyEnv, envDefaults, envOverrides, makeConfigVar } from '@harmony/util/env';
import { env } from '@harmony/util';
import { WorkItemQueueType } from '../../../../app/util/queue/queue';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for the work updater using the base environment variables
// and some specific to the updater
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

const allEnv = { ...envDefaults, ...envLocalDefaults, ...envOverrides, ...process.env };
const updaterEnvVars = _.cloneDeep(env) as IUpdaterHarmonyEnv;

for (const k of Object.keys(allEnv)) {
  makeConfigVar(updaterEnvVars, k, allEnv[k]);
}

// special case
updaterEnvVars.workItemUpdateQueueType = process.env.WORK_ITEM_UPDATE_QUEUE_TYPE === 'large' ? WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;

// validate the env vars
const updaterHarmonyEnvObj = new UpdaterHarmonyEnv(updaterEnvVars);
const errors = validateSync(updaterHarmonyEnvObj,  { validationError: { target: false } });
if (errors.length > 0) {
  for (const err of errors) {
    winston.error(err);
  }
  throw (new Error('BAD ENVIRONMENT'));
}

export default updaterEnvVars;
