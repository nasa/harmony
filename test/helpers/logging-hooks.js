const { before } = require('mocha');
const winston = require('winston');
const chai = require('chai');
const chaiHttp = require('chai-http');

const logger = require('../../app/util/log');

before(() => {
  // Ensure logs go to a file so they don't muck with test output
  const fileTransport = new winston.transports.File({ filename: 'logs/test.log' });
  while (process.env.stdoutlog !== 'true' && logger.transports.length > 0) {
    logger.remove(logger.transports[0]);
  }
  logger.add(fileTransport);

  chai.use(chaiHttp);
});
