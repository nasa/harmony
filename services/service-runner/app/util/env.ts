import * as path from 'path';

import { IsInt, IsNotEmpty, Max, Min, ValidateIf } from 'class-validator';
import _ from 'lodash';

import { HarmonyEnv } from '@harmony/util/env';


//
// env module
// Sets up the environment variables for the service runner using the base environment variables
// and some specific to the service runner
//

class HarmonyServiceEnv extends HarmonyEnv {

  @IsNotEmpty()
  artifactBucket: string;

  @IsNotEmpty()
  backendHost: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  backendPort: number;

  @IsNotEmpty()
  clientId: string;

  @IsNotEmpty()
  harmonyService: string;

  @ValidateIf(o => ! /query-cmr/.test(o.harmonyService))
  @IsNotEmpty()
  invocationArgs: string;

  @IsInt()
  @Min(0)
  maxPutWorkRetries: number;

  @IsNotEmpty()
  myPodName: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  workerPort: number;

  @IsInt()
  workerTimeout: number;

  @IsNotEmpty()
  workingDir: string;

  @IsNotEmpty()
  sharedSecretKey: string;
}

// validate the env vars
const localPath = path.resolve(__dirname, '../../env-defaults');
const harmonyServiceEnvObj = new HarmonyServiceEnv(localPath);
harmonyServiceEnvObj.validate();

export default harmonyServiceEnvObj;
