import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

process.env.NODE_ENV = 'test';

// We do not use an EDL application or call backend services in our tests.
process.env.COOKIE_SECRET = 'foo';
process.env.OAUTH_CLIENT_ID = 'foo';
process.env.OAUTH_UID = 'foo';
process.env.OAUTH_PASSWORD = 'foo';
process.env.SHARED_SECRET_KEY = 'foo';

// needed for aggregation tests
process.env.HOST_VOLUME_PATH = '/tmp';

// needed to keep lots of tests from auto-pausing
process.env.PREVIEW_THRESHOLD = '500';

// eslint-disable-next-line import/first
import env from '../../app/util/env'; // Must set required env before loading the env file

env.nodeEnv = 'test';

use(chaiAsPromised);

before(() => {
  stub(env, 'maxGranuleLimit').get(() => 2100);
  stub(env, 'harmonyClientId').get(() => 'harmony-test');
  stub(env, 'syncRequestPollIntervalMs').get(() => 0);
  stub(env, 'sharedSecretKey').get(() => Buffer.from('_THIS_IS_MY_32_CHARS_SECRET_KEY_', 'utf8'));
});
