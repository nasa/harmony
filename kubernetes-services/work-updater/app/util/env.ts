import { HarmonyEnv, IHarmonyEnv } from '@harmony/util/env';
import env from './util/env'
import { IsIn, IsInt, Max, Min, validateSync } from 'class-validator';
import winston from 'winston';
import { WorkItemQueueType } from '../../../../app/util/queue/queue';

//
// env module
// Sets up the environment variables for the work updater using the base environment variables
// and some specific to the updater
//

export interface IUpdaterHarmonyEnv extends IHarmonyEnv {
  port: number;
  largeWorkItemUpdateQueueMaxBatchSize: number;
  workItemUpdateQueueType: WorkItemQueueType;
  workItemUpdateQueueProcessorDelayAfterErrorSec: number;
  workItemSchedulerQueueUrl: string;
}

class UpdaterHarmonyEnv extends HarmonyEnv implements IUpdaterHarmonyEnv {

  @IsInt()
  @Min(0)
  @Max(65535)
    port: number;

  @IsInt()
  @Min(1)
    largeWorkItemUpdateQueueMaxBatchSize: number;

  @IsIn([WorkItemQueueType.LARGE_ITEM_UPDATE, WorkItemQueueType.SMALL_ITEM_UPDATE])
    workItemUpdateQueueType: WorkItemQueueType;

  @IsInt()
  @Min(0)
    workItemUpdateQueueProcessorDelayAfterErrorSec: number;

  constructor(private updaterHarmonyEnv: IUpdaterHarmonyEnv) {
    super(updaterHarmonyEnv);
  }
}

const updaterEnvVars = env as IUpdaterHarmonyEnv;

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
