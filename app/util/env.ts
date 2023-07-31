import { HarmonyEnv, IHarmonyEnv, hostRegexWhitelist } from '@harmony/util/env';
import { env } from '@harmony/util';
import { IsInt, IsNotEmpty, IsNumber, IsUrl, Length, Min, validateSync } from 'class-validator';
import winston from 'winston';

//
// harmony env module
// Sets up the environment variables for the Harmony server using the base environment variables
// and some specific to the server
//

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
  maxSynchronousGranules: number;
  maxErrorsForJob: number;
  previewThreshold: number;
  uploadBucket: string;
  logViewerGroupId: string;
  workFailerPeriodSec: number;
  workReaperPeriodSec: number;
  workFailerBatchSize: number;
  workReaperBatchSize: number;
  failableWorkAgeMinutes: number;
  syncRequestPollIntervalMs: number;
  maxBatchInputs: number;
  maxBatchSizeInBytes: number;
  getWorkSampleRatio: number;
  putWorkSampleRatio: number;
  getMetricsSampleRatio: number;
  openTelemetryUrl: string;
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

  @Length(128)
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
    workFailerPeriodSec: number;

  @IsInt()
  @Min(1)
    workReaperPeriodSec: number;

  @IsInt()
  @Min(1)
    workFailerBatchSize: number;

  @IsInt()
  @Min(1)
    workReaperBatchSize: number;

  @IsInt()
  @Min(1)
    failableWorkAgeMinutes: number;

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

  @IsNumber()
  @Min(0)
    getWorkSampleRatio: number;

  @IsNumber()
  @Min(0)
    putWorkSampleRatio: number;

  getMetricsSampleRatio: number;

  @IsUrl(hostRegexWhitelist)
    openTelemetryUrl: string;

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

  constructor(private harmonyServerEnv: IHarmonyServerEnv) {
    super(harmonyServerEnv);
  }
}

const serverEnvVars = env as IHarmonyServerEnv;

// validate the env vars
const harmonyServerEnvObj = new HarmonyServerEnv(serverEnvVars);
const errors = validateSync(harmonyServerEnvObj,  { validationError: { target: false } });
if (errors.length > 0) {
  for (const err of errors) {
    winston.error(err);
  }
  throw (new Error('BAD ENVIRONMENT'));
}

export default serverEnvVars;
