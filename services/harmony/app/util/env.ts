import { IsInt, IsNotEmpty, Min } from 'class-validator';
import { HarmonyEnv } from '@harmony/util/env';
import _ from 'lodash';
import * as path from 'path';

//
// harmony env module
// Sets up the environment variables for the Harmony server using the base environment variables
// and some specific to the server
//

class HarmonyServerEnv extends HarmonyEnv {
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

  @IsNotEmpty()
  serviceDeployerGroupId: string;

  @IsNotEmpty()
  corePermissionsGroupId: string;

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

  @IsInt()
  @Min(1)
  maxDataOperationCacheSize: number;

  locallyDeployedServices: string;
}

const localPath = path.resolve(__dirname, '../../env-defaults');
const harmonyServerEnvObj = new HarmonyServerEnv(localPath);
harmonyServerEnvObj.validate();

export default harmonyServerEnvObj;
