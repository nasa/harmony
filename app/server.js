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
const router = require('./routers/router');
const errorHandler = require('./middleware/error-handler');
const exampleBackend = require('../example/http-backend');
const ogcCoveragesApi = require('./frontends/ogc-coverages');
const RequestContext = require('./models/request-context');

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
    const id = uuid();
    const context = new RequestContext(id);
    context.logger = appLogger.child({ requestId: id });
    req.context = context;
    next();
  };

  const addRequestLogger = expressWinston.logger({
    winstonInstance: appLogger,
    dynamicMeta(req) { return { requestId: req.context.id }; },
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
 *     PORT: {number} The port to run the frontend server on
 *     BACKEND_PORT: {number} The port to run the backend server on
 *     BACKEND_HOST: {string} The hostname of the backend server for callbacks to use
 *     USE_HTTPS: {bool} True if the backend should use https, false if http.  Defaults to false if
 *       backend host is localhost, otherwise true
 *     EXAMPLE_SERVICES: {bool} True if we should run example services, false otherwise.  Should
 *       be false in production.  Defaults to true until we have real HTTP services.
 *
 * @returns {object} An object with "frontend" and "backend" keys with running http.Server objects
 */
function start(config = {}) {
  const appPort = config.PORT || 3000;
  const backendPort = config.BACKEND_PORT || 3001;
  const backendHost = config.BACKEND_HOST || 'localhost';
  const backendProtocol = (config.USE_HTTPS === 'true' || backendHost !== 'localhost') ? 'https' : 'http';

  // Setup the frontend server to handle client requests
  const frontend = buildServer('frontend', appPort, (app) => {
    if (config.EXAMPLE_SERVICES !== 'false') {
      app.use('/example', exampleBackend.router());
    }
    app.use('/', router(config));
    // Error handlers that format errors outside of their routes / middleware need to be mounted
    // at the top level, not on a child router, or they get skipped.
    ogcCoveragesApi.handleOpenApiErrors(app);
  });

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to acccept callbacks from backend services
  const backend = buildServer('backend', backendPort, (app) => {
    app.use('/service', serviceResponseRouter(config));

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
