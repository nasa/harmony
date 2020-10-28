import { before } from 'mocha';

// Disable import/first so we can ensure correct default replay behavior
/* eslint-disable import/first */
process.env.SHARED_SECRET_KEY = '_THIS_IS_MY_32_CHARS_SECRET_KEY_';
process.env.NODE_ENV = 'test';
process.env.AWS_DEFAULT_REGION = 'us-west-2';
process.env.HARMONY_CLIENT_ID = 'harmony-test';

import * as winston from 'winston';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { cmrApiConfig } from '../../../../app/util/cmr';
import logger from '../../../../app/util/log';

use(chaiAsPromised);

before(() => {
  cmrApiConfig.useToken = false;

  // Ensure logs go to a file so they don't muck with test output
  const fileTransport = new winston.transports.File({ filename: 'logs/test.log' });
  while (process.env.LOG_STDOUT !== 'true' && logger.transports.length > 0) {
    logger.remove(logger.transports[0]);
  }
  logger.add(fileTransport);
});
