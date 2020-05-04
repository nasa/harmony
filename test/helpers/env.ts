import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import env = require('harmony/util/env');

process.env.NODE_ENV = 'test';

use(chaiAsPromised);

before(() => {
  stub(env, 'harmonyClientId').get(() => 'harmony-test');
});
