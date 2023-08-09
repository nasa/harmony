import { IsNotEmpty, validateSync } from 'class-validator';
import * as winston from 'winston';
import { HarmonyEnv, IHarmonyEnv } from '@harmony/util/env';
import { env } from '@harmony/util';
import _ from 'lodash';

//
// env module
// Sets up the environment variables for query-cmr using the base environment variables
// and some specific to services.
// Currently this is just a placeholder for future vars we might need for query-cmr.
//

interface IQueryCmrServiceEnv extends IHarmonyEnv {
}

class QueryCmrServiceEnv extends HarmonyEnv implements IQueryCmrServiceEnv {
}

const envVars: IQueryCmrServiceEnv = _.cloneDeep(env) as IQueryCmrServiceEnv;

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