/* eslint-disable import/first */
import * as dotenv from 'dotenv';
import * as winston from 'winston';

if (dotenv.config().error) {
  winston.warn('Did not read a .env file');
}

import express from 'express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import * as url from 'url';
import { promisify } from 'util';
import * as serviceResponse from 'backends/service-response';
import errorHandler from 'middleware/error-handler';
import router from 'routers/router';
import RequestContext from 'models/request-context';
import * as ogcCoveragesApi from './frontends/ogc-coverages';
import serviceResponseRouter from './routers/service-response-router';

import logger = require('util/log');
import exampleBackend = require('../example/http-backend');

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
export function start(config: any = {}) {
  console.log('STARTING SERVER');
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

  // Setup the backend server to accept callbacks from backend services
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
export async function stop({ frontend, backend }) {
  const closeFrontend = promisify(frontend.close.bind(frontend));
  const closeBackend = promisify(backend.close.bind(backend));
  await Promise.all([closeFrontend(), closeBackend()]);
}

if (require.main === module) {
  start(process.env);
}
