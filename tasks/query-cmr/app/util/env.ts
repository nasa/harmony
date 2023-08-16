/* eslint-disable @typescript-eslint/no-empty-interface */
import { HarmonyEnv, IHarmonyEnv, validateEnvironment, envVars } from '@harmony/util/env';
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

const serviceEnvVars: IQueryCmrServiceEnv = _.cloneDeep(envVars) as IQueryCmrServiceEnv;

// validate the env vars
const harmonyQueryServiceEnvObj = new QueryCmrServiceEnv(serviceEnvVars);
validateEnvironment(harmonyQueryServiceEnvObj);

export default serviceEnvVars;