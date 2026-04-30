import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { before } from 'mocha';

import { configureLogToFile } from '../../../harmony/app/util/log';

use(chaiAsPromised);

before(() => {
  // Ensure logs go to a file so they don't muck with test output
  configureLogToFile('logs/test.log', process.env.LOG_STDOUT !== 'true');
});
