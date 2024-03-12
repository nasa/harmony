import { before } from 'mocha';

import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { cmrApiConfig } from '@harmony/harmony/app/util/cmr';
import { configureLogToFile } from '@harmony/harmony/app/util/log';

use(chaiAsPromised);

before(() => {
  cmrApiConfig.useToken = false;

  // Ensure logs go to a file so they don't muck with test output
  configureLogToFile('logs/test.log', process.env.LOG_STDOUT !== 'true');
});
