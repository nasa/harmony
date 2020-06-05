import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import env from '../../app/util/env';

env.nodeEnv = 'test';

process.env.AWS_DEFAULT_REGION = 'us-west-2';

use(chaiAsPromised);

before(() => {
  stub(env, 'harmonyClientId').get(() => 'harmony-test');
  stub(env, 'callbackUrlRoot').get(() => 'http://localhost:3001');
  stub(env, 'pollInterval').get(() => 0);
});
