const { before } = require('mocha');
const winston = require('winston');

const logger = require('../../app/util/log');

before(() => {
  // Ensure logs go to a file so they don't muck with test output
  const fileTransport = new winston.transports.File({ filename: 'logs/test.log' });
  while (process.env.LOG_STDOUT !== 'true' && logger.transports.length > 0) {
    logger.remove(logger.transports[0]);
  }
  logger.add(fileTransport);
});
