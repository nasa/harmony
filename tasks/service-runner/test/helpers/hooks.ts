import { before } from 'mocha';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { configureLogToFile } from '../../../../app/util/log';

use(chaiAsPromised);

before(() => {
  // Ensure logs go to a file so they don't muck with test output
  configureLogToFile('logs/test.log', process.env.LOG_STDOUT !== 'true');
});
