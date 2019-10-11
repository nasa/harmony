const dotenvResult = require('dotenv').config();
const express = require('express');
const winston = require('winston');
const expressWinston = require('express-winston');
const favicon = require('serve-favicon');
const path = require('path');
const uuid = require('uuid');
const url = require('url');
const { promisify } = require('util');
const logger = require('./util/log');
const serviceResponse = require('./backends/service-response');
const serviceResponseRouter = require('./routers/service-response-router');
const eoss = require('./frontends/eoss');
const router = require('./routers/router');
const errorHandler = require('./middleware/error-handler');

if (dotenvResult.error) {
  winston.warn('Did not read a .env file');
}

/**
 * Builds an express server with appropriate logging and default routing and starts the server
 * listening on the provided port.
 *
 * @param {string} name The name of the server, as identified in logs
 * @param {number} port The port the server should listen on
 * @param {Function} setupFn A function that takes an express app and adds non-default behavior
 * @returns {express.Application} The running express application
 */
function buildServer(name, port, setupFn) {
  const appLogger = logger.child({ application: name });

  const addRequestId = (req, res, next) => {
    req.id = uuid();
    req.logger = appLogger.child({ requestId: req.id });
    next();
  };

  const addRequestLogger = expressWinston.logger({
    winstonInstance: appLogger,
    dynamicMeta(req) { return { requestId: req.id }; },
  });

  const app = express();

  app.use(addRequestId);
  app.use(addRequestLogger);

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));

  if (setupFn) {
    setupFn(app);
  }

  app.use(errorHandler);

  return app.listen(port, '0.0.0.0', () => appLogger.info(`Application "${name}" listening on port ${port}`));
}

/**
 * Starts the servers required to serve Harmony
 *
 * @param {object} [config={}] An optional configuration object containing server config.
 *   When running this module using the CLI, the configuration is pulled from the environment.
 *   Config values:
 *     port: {number} The port to run the frontend server on
 *     backendPort: {number} The port to run the backend server on
 *     backendHost: {string} The hostname of the backend server for callbacks to use
 *     useHttps: {bool} True if the backend should use https, false if http.  Defaults to false if
 *       backend host is localhost, otherwise true
 *
 * @returns {object} An object with "frontend" and "backend" keys with running http.Server objects
 */
function start(config = {}) {
  const appPort = config.port || 3000;
  const backendPort = config.backendPort || 3001;
  const backendHost = config.backendHost || 'localhost';
  const backendProtocol = (config.useHttps || backendHost !== 'localhost') ? 'https' : 'http';

  // Setup the frontend server to handle client requests
  const frontend = buildServer('frontend', appPort, (app) => {
    eoss.addOpenApiRoutes(app);
    app.use('/', router());
  });

  // Setup the backend server to acccept callbacks from backend services
  const backend = buildServer('backend', backendPort, (app) => {
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

  return { frontend, backend };
}

/**
 * Stops the express servers created and returned by the start() method
 *
 * @param {object} servers An object containing "frontend" and "backend" keys tied to http.Server
 *   objects, as returned by start()
 * @returns {Promise<void>} A promise that completes when the servers close
 */
async function stop({ frontend, backend }) {
  const closeFrontend = promisify(frontend.close.bind(frontend));
  const closeBackend = promisify(backend.close.bind(backend));
  await Promise.all([closeFrontend(), closeBackend()]);
}

module.exports = { start, stop };

if (require.main === module) {
  start(process.env);
}
