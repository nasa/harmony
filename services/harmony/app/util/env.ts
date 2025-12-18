import { IsBoolean, IsInt, IsNotEmpty, IsPositive, Matches, Min } from 'class-validator';
import _ from 'lodash';
import * as path from 'path';

import { HarmonyEnv, memorySizeRegex } from '@harmony/util/env';

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

  oauthClientId: string;

  oauthHost: string;

  oauthPassword: string;

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
  @Min(1)
  minDoneItemsForFailCheck: number;

  @IsInt()
  @Min(0)
  maxPercentErrorsForJob: number;

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

  @Matches(memorySizeRegex)
  maxHarmonyBackEndJsonSize: string;

  @IsInt()
  @Min(1)
  maxDataOperationCacheSize: number;

  @IsInt()
  @Min(1)
  tokenCacheSize: number;

  @IsInt()
  @Min(1)
  tokenCacheTtl: number;

  @IsInt()
  @Min(1)
  providerCacheSize: number;

  @IsInt()
  @Min(1)
  providerCacheTtl: number;

  @IsInt()
  @Min(1)
  collectionCacheSize: number;

  @IsInt()
  @Min(1)
  collectionCacheTtl: number;

  @IsInt()
  @Min(1)
  edlCacheSize: number;

  @IsInt()
  @Min(1)
  edlCacheTtl: number;

  @IsInt()
  @Min(1)
  cmrCacheSize: number;

  @IsInt()
  @Min(1)
  cmrCacheTtl: number;

  @IsInt()
  @Min(1)
  jobStatusCacheSize: number;

  @IsInt()
  @Min(1)
  jobStatusCacheTtl: number;

  @IsPositive()
  wktPrecision: number;

  @IsPositive()
  maxPointCircleSides: number;

  @IsPositive()
  pointCircleFunctionBase: number;

  locallyDeployedServices: string;

  labelsAllowList: string;

  labelsForbidList: string;

  @IsInt()
  @Min(1)
  labelFilterCompletionCount: number;

  @IsBoolean()
  uiLabeling: boolean;

  @IsBoolean()
  useEdlClientApp: boolean;

  edlToken: string;

  @IsBoolean()
  allowServiceSelection: boolean;
}

const localPath = path.resolve(__dirname, '../../env-defaults');
const harmonyServerEnvObj = new HarmonyServerEnv(localPath);
harmonyServerEnvObj.validate();

export default harmonyServerEnvObj;
