/* eslint-disable @typescript-eslint/no-empty-interface */
import { HarmonyEnv, IHarmonyEnv, validateEnvironment } from '@harmony/util/env';
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
validateEnvironment(harmonyQueryServiceEnvObj);

export default envVars;