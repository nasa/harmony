const dotenvResult = require('dotenv').config();
const express = require('express');
const winston = require('winston');
const expressWinston = require('express-winston');
const favicon = require('serve-favicon');
const path = require('path');
const uuid = require('uuid');
const url = require('url');
const serviceResponse = require('./backends/service-response');
const serviceResponseRouter = require('./routers/service-response-router');
const router = require('./routers/router');

const appPort = process.env.port || 3000;
const backendPort = process.env.backendPort || 3001;
const backendHost = process.env.backendHost || 'localhost';
const backendProtocol = (process.env.useHttps || backendHost !== 'localhost') ? 'https' : 'http';

if (dotenvResult.error) {
  winston.warn('Did not read a .env file');
}

/**
 * Helper method that formats a string as a log tag only if it is provided
 *
 * @param {string} tag The tag string to add
 * @returns {string} The input string in tag format, or the empty string if tag does not exist
 */
function optionalTag(tag) {
  return tag ? ` [${tag}]` : '';
}

/**
 * Builds an express server with appropriate logging and default routing and starts the server
 * listening on the provided port.
 *
 * @param {string} name The name of the server, as identified in logs
 * @param {number} port The port the server should listen on
 * @param {Function} setupFn A function that takes an express app and adds non-default behavior
 * @returns {void}
 */
function buildServer(name, port, setupFn) {
  const textformat = winston.format.printf(
    (info) => `[${info.level}]${optionalTag(info.application)}${optionalTag(info.requestId)}${optionalTag(info.component)}: ${info.message}`,
  );

  const logger = winston.createLogger({
    defaultMeta: { application: name },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.prettyPrint(),
      winston.format.colorize({ colors: { error: 'red', info: 'blue' } }),
      textformat,
    ),
    transports: [
      new winston.transports.Console(),
    ],
  });

  const addRequestId = (req, res, next) => {
    req.id = uuid();
    req.logger = logger.child({ requestId: req.id });
    next();
  };

  const addRequestLogger = expressWinston.logger({
    winstonInstance: logger,
    dynamicMeta(req) { return { requestId: req.id }; },
  });

  const app = express();

  app.use(addRequestId);
  app.use(addRequestLogger);

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));

  if (setupFn) {
    setupFn(app);
  }

  app.listen(port, '0.0.0.0', () => logger.info(`Application "${name}" listening on port ${port}`));
}

// Setup the frontend server to handle client requests
buildServer('frontend', appPort, (app) => {
  app.use('/', router());
});

// Setup the backend server to acccept callbacks from backend services
buildServer('backend', backendPort, (app) => {
  app.use('/service', serviceResponseRouter());

  serviceResponse.configure({
    baseUrl: url.format({
      protocol: backendProtocol,
      hostname: backendHost,
      port: backendPort,
      pathname: '/service/',
    }),
  });
});
