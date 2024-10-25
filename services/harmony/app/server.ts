import express, { Response, NextFunction, RequestHandler } from 'express';
import mustacheExpress from 'mustache-express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import { promisify } from 'util';
import * as http from 'http';
import * as https from 'https';
import { Logger } from 'winston';
import { profanity } from '@2toad/profanity';
import env from './util/env';
import errorHandler from './middleware/error-handler';
import logForRoutes from './middleware/log-for-routes';
import router, { RouterConfig } from './routers/router';
import RequestContext from './models/request-context';
import HarmonyRequest from './models/harmony-request';
import serviceResponseRouter from './routers/backend-router';
import { handleOpenApiErrors } from './util/errors';
import logger from './util/log';
import * as exampleBackend from '../example/http-backend';
import cmrCollectionReader from './middleware/cmr-collection-reader';
import * as fs from 'fs';

/**
 * Mutate specific properties of the expressWinston request object
 * in order to control what shows up in the logs.
 * @param req - the expressWinston request
 * @param propName - the property name
 * @returns the mutated (or same) property value for the given property name
 */
export function requestFilter(req, propName): expressWinston.RequestFilter {
  const redactedString = '<redacted>';
  if (propName === 'headers') {
    const headersObj = req[propName];
    if (headersObj.cookie) {
      headersObj.cookie = redactedString;
    }
    if (headersObj.authorization) {
      headersObj.authorization = redactedString;
    }
    if (headersObj['cookie-secret']) {
      headersObj['cookie-secret'] = redactedString;
    }
    return headersObj;
  }
  return req[propName];
}

/**
 * Returns middleware to add a request specific logger
 *
 * @param appLogger - Request specific application logger
 * @param ignorePaths - Don't log the request url and method if the req.path matches these patterns
 */
function addRequestLogger(appLogger: Logger, ignorePaths: RegExp[] = []): RequestHandler {
  return expressWinston.logger({
    winstonInstance: appLogger,
    requestFilter,
    dynamicMeta(req: HarmonyRequest) { return { requestId: req.context.id }; },
    ignoreRoute(req) { return ignorePaths.some((p) => req.path.match(p)); },
  });
}

/**
 * Returns middleware to set a requestID for a request if the request does not already
 * have one set. Also adds requestUrl to the logger info object.
 *
 * @param appLogger - Request specific application logger
 */
function addRequestId(appLogger: Logger): RequestHandler {
  return (req: HarmonyRequest, res: Response, next: NextFunction): void => {
    const requestId = req.context?.id || uuid();
    const requestUrl = req.url;
    const context = new RequestContext(requestId);
    context.logger = appLogger.child({ requestId, requestUrl });
    req.context = context;
    next();
  };
}

/**
 * Builds an express server with appropriate logging and starts the backend server
 * listening on the provided port.
 *
 * @param port - The port the server should listen on
 * @param hostBinding - The host network interface to bind against
 * @returns The running express application
 */
function buildBackendServer(port: number, hostBinding: string, useHttps: string): http.Server | https.Server {
  const appLogger = logger.child({ application: 'backend' });
  const setRequestId = (req: HarmonyRequest, res: Response, next: NextFunction): void => {
    const { requestId } = req.params;

    const context = new RequestContext(requestId);
    req.context = context;
    next();
  };

  const app = express();
  app.use('/service/:requestId/*', setRequestId);
  app.use(addRequestId(appLogger));

  // we don't need express-winston to log every service work polling request
  const servicePollingRegexp = /^\/service\/(work|metrics)$/;
  app.use(addRequestLogger(appLogger, [servicePollingRegexp]));

  // currently, only this service response route is timed (for the backend)
  const serviceResponseRegexp = /^\/service\/[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\/response$/i;
  app.use(logForRoutes('timing.backend-request.start', 'allow', [serviceResponseRegexp]));

  app.use(favicon(path.join(__dirname, '..', 'public/assets/images', 'favicon.ico')));
  app.use('/service', serviceResponseRouter());
  app.get('/', ((req, res) => res.send('OK')));
  app.use(errorHandler);

  let listener;
  if (useHttps === 'true') {
    const privateKey = fs.readFileSync(path.join(__dirname, 'certs/harmony-cert.key'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'certs/harmony-cert.crt'), 'utf8');

    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);
    listener = httpsServer.listen(port, hostBinding, () => appLogger.info(`Application backend listening using HTTPS on ${hostBinding} on port ${port}`));
  } else {
    listener = app.listen(port, hostBinding, () => appLogger.info(`Application backend listening using HTTP on ${hostBinding} on port ${port}`));
  }
  return listener;
}

/**
 * Builds an express server with appropriate logging and routing and starts the frontend server
 * listening on the provided port.
 *
 * @param port - The port the server should listen on
 * @param hostBinding - The host network interface to bind against
 * @param config - Config that controls whether certain middleware will be used
 * @returns The running express application
 */
function buildFrontendServer(port: number, hostBinding: string, config: RouterConfig): http.Server | https.Server {
  const appLogger = logger.child({ application: 'frontend' });
  const app = express();
  app.use(addRequestId(appLogger));
  app.use(addRequestLogger(appLogger));

  // currently, only service requests are timed (for the frontend)
  app.use(logForRoutes('timing.frontend-request.start', 'allow', [cmrCollectionReader.collectionRegex]));

  app.use(favicon(path.join(__dirname, '..', 'public/assets/images', 'favicon.ico')));

  // Setup mustache as a templating engine for HTML views
  const engine = mustacheExpress();
  engine.cache = null;
  app.engine('mustache.html', engine);
  app.set('view engine', 'mustache.html');
  app.set('views', path.join(__dirname, 'views'));

  if (config.EXAMPLE_SERVICES !== 'false') {
    app.use('/example', exampleBackend.router());
  }
  app.use('/', router(config));
  // Error handlers that format errors outside of their routes / middleware need to be mounted
  // at the top level, not on a child router, or they get skipped.
  handleOpenApiErrors(app);
  app.use(errorHandler);

  let listener;
  if (config.USE_HTTPS === 'true') {
    const privateKey = fs.readFileSync(path.join(__dirname, 'certs/harmony-cert.key'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'certs/harmony-cert.crt'), 'utf8');

    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);
    listener = httpsServer.listen(port, hostBinding, () => appLogger.info(`Application frontend listening using HTTPS on ${hostBinding} on port ${port}`));
  } else {
    listener = app.listen(port, hostBinding, () => appLogger.info(`Application frontend listening using HTTP on ${hostBinding} on port ${port}`));
  }
  return listener;
}

/**
 * Starts the servers required to serve Harmony
 *
 * @param config - An optional configuration object containing server config.
 *   When running this module using the CLI, the configuration is pulled from the environment.
 *   Config values:
 *     PORT: The port to run the frontend server on
 *     BACKEND_PORT: The port to run the backend server on
 *     CALLBACK_URL_ROOT: The base URL for callbacks to use
 *     EXAMPLE_SERVICES: True if we should run example services, false otherwise.  Should
 *       be false in production.  Defaults to true until we have real HTTP services.
 *
 * @returns An object with "frontend" and "backend" keys with running http.Server objects
 */
export function start(config: Record<string, string>): {
  frontend: http.Server | https.Server;
  backend: http.Server | https.Server;
} {

  // add explicitly allowed words for label filter
  let allowList = [];
  if (env.labelsAllowList) {
    allowList = env.labelsAllowList.split(',');
  }
  profanity.whitelist.addWords(allowList);
  // set explicitly forbidden words for label filter
  let forbiddenList = [];
  if (env.labelsForbidList) {
    forbiddenList = env.labelsForbidList.split(',');
  }
  profanity.addWords(forbiddenList);

  // Log unhandled promise rejections and do not crash the node process
  process.on('unhandledRejection', (reason, _promise) => {
    logger.error('Unhandled Rejection:', reason);
  });

  const appPort = +config.PORT;
  const backendPort = +config.BACKEND_PORT;

  // Setup the frontend server to handle client requests
  const frontend = buildFrontendServer(appPort, config.HOST_BINDING, config);

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to accept callbacks from backend services
  const backend = buildBackendServer(backendPort, config.HOST_BINDING, config.USE_HTTPS);

  return { frontend, backend };
}

/**
 * Stops the express servers created and returned by the start() method
 *
 * @param frontend - http.Server object as returned by start()
 * @param backend - http.Server object as returned by start()
 * @param workReaper - service that checks for old work items and workflow steps and deletes them
 * @returns A promise that completes when the servers close
 */
export async function stop({
  frontend,
  backend,
  workReaper }): Promise<void> {
  await Promise.all([
    promisify(frontend.close.bind(frontend))(),
    promisify(backend.close.bind(backend))(),
    workReaper?.stop(),
  ]);
}

if (require.main === module) {
  start(process.env);
}
