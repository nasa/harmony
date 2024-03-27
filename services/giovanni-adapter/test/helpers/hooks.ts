import { hookMockS3 } from '@harmony/harmony/test/helpers/object-store';
import { before } from 'mocha';

import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { configureLogToFile } from '@harmony/harmony/app/util/log';

hookMockS3();

use(chaiAsPromised);

before(() => {
  // Ensure logs go to a file so they don't muck with test output
  configureLogToFile('logs/test.log', process.env.LOG_STDOUT !== 'true');
});
