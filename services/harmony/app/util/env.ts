import { IsInt, IsNotEmpty, Min } from 'class-validator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonyEnv, IHarmonyEnv, makeConfigVar, validateEnvironment, envVars } from '@harmony/util/env';
import _ from 'lodash';

//
// harmony env module
// Sets up the environment variables for the Harmony server using the base environment variables
// and some specific to the server
//

// read the local env-defaults
const localPath = path.resolve(__dirname, '../../env-defaults');
const envLocalDefaults = dotenv.parse(fs.readFileSync(localPath));

export interface IHarmonyServerEnv extends IHarmonyEnv {
  aggregateStacCatalogMaxPageSize: number;
  adminGroupId: string;
  defaultJobListPageSize: number
  oauthClientId: string;
  oauthHost: string;
  oauthPassword: string;
  oauthUid: string;
  sharedSecretKey: string;
  cookieSecret: string;
  metricsEndpoint: string;
  metricsIndex: string;
  maxPageSize: number;
  maxPostFields: number;
  maxPostFileParts: number;
  maxPostFileSize: number;
  maxSynchronousGranules: number;
  maxErrorsForJob: number;
  previewThreshold: number;
  uploadBucket: string;
  logViewerGroupId: string;
  syncRequestPollIntervalMs: number;
  maxBatchInputs: number;
  maxBatchSizeInBytes: number;
}

class HarmonyServerEnv extends HarmonyEnv implements IHarmonyServerEnv {
  @IsInt()
  aggregateStacCatalogMaxPageSize: number;

  @IsNotEmpty()
  adminGroupId: string;

  @IsNotEmpty()
  oauthClientId: string;

  @IsNotEmpty()
  oauthHost: string;

  @IsNotEmpty()
  oauthPassword: string;

  @IsNotEmpty()
  oauthUid: string;

  @IsNotEmpty()
  sharedSecretKey: string;

  @IsNotEmpty()
  cookieSecret: string;

  metricsEndpoint: string;

  metricsIndex: string;

  @IsInt()
  @Min(1)
  defaultJobListPageSize: number;

  @IsInt()
  @Min(1)
  maxPageSize: number;

  @IsInt()
  @Min(1)
  maxSynchronousGranules: number;

  @IsInt()
  @Min(1)
  maxErrorsForJob: number;

  @IsInt()
  @Min(0)
  previewThreshold: number;

  @IsNotEmpty()
  uploadBucket: string;

  @IsNotEmpty()
  logViewerGroupId: string;

  @IsInt()
  @Min(1)
  syncRequestPollIntervalMs: number;

  @IsInt()
  @Min(1)
  maxBatchInputs: number;

  @IsInt()
  @Min(1)
  maxBatchSizeInBytes: number;

  @IsInt()
  @Min(0)
  workItemRetryLimit: number;

  @IsNotEmpty()
  objectStoreType: string;

  @IsInt()
  @Min(1)
  maxPostFields: number;

  @IsInt()
  @Min(1)
  maxPostFileParts: number;

  @IsInt()
  @Min(1)
  maxPostFileSize: number;

}

const serverEnvVars = _.cloneDeep(envVars) as IHarmonyServerEnv;

for (const k of Object.keys(envLocalDefaults)) {
  // some values defined above may already be set via .env
  const variableValue = serverEnvVars[_.camelCase(k)];
  if (variableValue === undefined || variableValue === '') {
    serverEnvVars[_.camelCase(k)] = makeConfigVar(envLocalDefaults[k]);
  }
  if (process.env[k] === undefined || process.env[k] === '') {
    process.env[k] = envLocalDefaults[k];
  }
}

// validate the env vars
const harmonyServerEnvObj = new HarmonyServerEnv(serverEnvVars);
validateEnvironment(harmonyServerEnvObj);

export default serverEnvVars;
