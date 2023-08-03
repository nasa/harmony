import { IsNotEmpty, validateSync } from 'class-validator';
import * as winston from 'winston';
import { HarmonyEnv, IHarmonyEnv } from '@harmony/util/env';
import { env } from '@harmony/util';

//
// env module
// Sets up the environment variables for query-cmr using the base environment variables
// and some specific to services
//

interface IQueryCmrServiceEnv extends IHarmonyEnv {
  workingDir: string;
}

class QueryCmrServiceEnv extends HarmonyEnv implements IQueryCmrServiceEnv {
  @IsNotEmpty()
    workingDir: string;
}

const envVars: IQueryCmrServiceEnv = env as IQueryCmrServiceEnv;

// validate the env vars
const harmonyQueryServiceEnvObj = new QueryCmrServiceEnv(envVars);
const errors = validateSync(harmonyQueryServiceEnvObj,  { validationError: { target: false } });
if (errors.length > 0) {
  for (const err of errors) {
    winston.error(err);
  }
  throw (new Error('BAD ENVIRONMENT'));
}

export default envVars;