import _ from 'lodash';

import { HarmonyEnv } from '@harmony/util/env';

//
// env module
// Sets up the environment variables for query-cmr using the base environment variables
// and some specific to services.
// Currently this is just a placeholder for future vars we might need for query-cmr.
//

class QueryCmrServiceEnv extends HarmonyEnv {
}

// validate the env vars
const harmonyQueryServiceEnvObj = new QueryCmrServiceEnv();
harmonyQueryServiceEnvObj.validate();

export default harmonyQueryServiceEnvObj;
