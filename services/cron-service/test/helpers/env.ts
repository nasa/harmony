import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

process.env.NODE_ENV = 'test';
process.env.DATABASE_TYPE = 'sqlite';

// We do not use an EDL application or call backend services in our tests.
process.env.COOKIE_SECRET = 'foo';
process.env.OAUTH_CLIENT_ID = 'foo';
process.env.OAUTH_UID = 'foo';
process.env.OAUTH_PASSWORD = 'foo';
process.env.SHARED_SECRET_KEY = 'foo';

// needed to keep lots of tests from auto-pausing
process.env.PREVIEW_THRESHOLD = '500';

// prevent tests from using a different page size and creating many fixtures
process.env.CMR_MAX_PAGE_SIZE = '100';

// use reasonable aggregation batch sizes for tests
process.env.MAX_BATCH_INPUTS = '3';
process.env.MAX_BATCH_SIZE_IN_BYTES = '10000';

process.env.PORT = '4000';

// eslint-disable-next-line import/first
import env from '../../app/util/env'; // Must set required env before loading the env file

env.nodeEnv = 'test';
env.databaseType = 'sqlite';
process.setMaxListeners(Infinity);

use(chaiAsPromised);

before(() => {
  stub(env, 'maxGranuleLimit').get(() => 2100);
  stub(env, 'clientId').get(() => 'harmony-test');
});
