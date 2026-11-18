import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

process.env.NODE_ENV = 'test';
// Tests query a local fixture (see helpers/db.ts), so no S3 Table bucket is needed
process.env.USE_LOCALSTACK = 'true';
process.env.PORT = '4000';

import env from '../../app/util/env'; // Must set required env before loading the env file

env.nodeEnv = 'test';
process.setMaxListeners(Infinity);

use(chaiAsPromised);
