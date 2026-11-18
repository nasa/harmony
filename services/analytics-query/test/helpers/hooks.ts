import { after, before } from 'mocha';

import { buildFixture, removeFixture } from './fixture';
import { configureLogToFile } from '../../app/util/log';

before(async () => {
  // Ensure logs go to a file so they don't muck with test output
  configureLogToFile('logs/test.log', process.env.LOG_STDOUT !== 'true');
  await buildFixture();
});

after(() => {
  removeFixture();
});
