import * as path from 'path';

import { IsInt, IsNotEmpty, Matches, Min, ValidateIf } from 'class-validator';

import { HarmonyEnv, memorySizeRegex } from '../../../../packages/util/env';

// The ANALYTICS_QUERY_SHARED_SECRET in env-defaults, which is only acceptable for local development
export const LOCAL_SHARED_SECRET = 'local-development-only';

//
// env module
// Sets up the environment variables for the analytics query service using the base environment
// variables and some specific to this service
//

class AnalyticsQueryHarmonyEnv extends HarmonyEnv {

  @ValidateIf(obj => obj.useLocalstack === false && !obj.analyticsQueryFixturePath)
  @IsNotEmpty()
  s3TableBucketArn: string;

  @IsNotEmpty()
  @ValidateIf(obj => obj.useLocalstack === false)
  @Matches(new RegExp(`^(?!${LOCAL_SHARED_SECRET}$)`), {
    message: 'ANALYTICS_QUERY_SHARED_SECRET must be set to a real secret outside local development',
  })
  analyticsQuerySharedSecret: string;

  @Matches(memorySizeRegex)
  analyticsQueryMemoryLimit: string;

  @IsInt()
  @Min(1)
  analyticsQueryThreads: number;

  @IsInt()
  @Min(1)
  analyticsQueryMaxConcurrent: number;

  @IsInt()
  @Min(0)
  analyticsQueryMaxWaiting: number;

  @IsInt()
  @Min(1)
  analyticsQueryTimeoutMs: number;

  @IsInt()
  @Min(1)
  analyticsQueryMaxRows: number;

  @IsInt()
  @Min(0)
  analyticsSchemaCacheSeconds: number;

  @IsInt()
  @Min(0)
  analyticsQueryInstanceMaxAgeMinutes: number;

  analyticsQueryFixturePath: string;
}

const localPath = path.resolve(__dirname, '../../env-defaults');

// validate the env vars
const analyticsQueryHarmonyEnvObj = new AnalyticsQueryHarmonyEnv(localPath);
analyticsQueryHarmonyEnvObj.validate();

export default analyticsQueryHarmonyEnvObj;
