import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import env from '../../app/util/env';

env.nodeEnv = 'test';

// We do not use an EDL application in our tests
process.env.COOKIE_SECRET = 'foo';
process.env.OAUTH_CLIENT_ID = 'foo';
process.env.OAUTH_UID = 'foo';
process.env.OAUTH_PASSWORD = 'foo';

use(chaiAsPromised);

before(() => {
  stub(env, 'maxGranuleLimit').get(() => 350);
  stub(env, 'harmonyClientId').get(() => 'harmony-test');
  stub(env, 'syncRequestPollIntervalMs').get(() => 0);
  stub(env, 'sharedSecretKey').get(() => Buffer.from('_THIS_IS_MY_32_CHARS_SECRET_KEY_', 'utf8'));
});
