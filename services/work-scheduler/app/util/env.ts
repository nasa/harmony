import { IsInt, IsNotEmpty, IsNumber, Min } from 'class-validator';
import _ from 'lodash';
import path from 'path';

import { HarmonyEnv } from '@harmony/util/env';

//
// env module
// Sets up the environment variables for the work scheduler using the base environment variables
// and some specific to the work scheduler
//

class HarmonyWorkSchedulerEnv extends HarmonyEnv {

  @IsNumber()
  @Min(0)
  serviceQueueBatchSizeCoefficient: number;

  @IsNumber()
  @Min(0)
  fastServiceQueueBatchSizeCoefficient: number;

  @IsNotEmpty()
  workingDir: string;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxBatchSize: number;

  @IsInt()
  @Min(1)
  workItemSchedulerQueueMaxGetMessageRequests: number;

  @IsInt()
  @Min(1)
  workItemSchedulerBatchSize: number;

  @IsInt()
  @Min(-1)
  maxWorkItemsOnUpdateQueue: number;

  @IsInt()
  @Min(1)
  podCountCacheTtl: number;
}

const localPath = path.resolve(__dirname, '../../env-defaults');
const envObj = new HarmonyWorkSchedulerEnv(localPath);
envObj.validate();

export default envObj;
