import express, { Response, NextFunction, RequestHandler } from 'express';
import mustacheExpress from 'mustache-express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import { promisify } from 'util';
import { Server } from 'http';
import { Logger } from 'winston';
import errorHandler from './middleware/error-handler';
import logForRoutes from './middleware/log-for-routes';
import router, { RouterConfig } from './routers/router';
import RequestContext from './models/request-context';
import HarmonyRequest from './models/harmony-request';
import * as ogcCoveragesApi from './frontends/ogc-coverages';
import serviceResponseRouter from './routers/backend-router';
import logger from './util/log';
import * as exampleBackend from '../example/http-backend';
import WorkReaper from './workers/work-reaper';
import WorkFailer from './workers/work-failer';
import cmrCollectionReader from './middleware/cmr-collection-reader';

/**
 * Returns middleware to add a request specific logger
 *
 * @param appLogger - Request specific application logger
 * @param ignorePaths - Don't log the request url and method if the req.path matches these patterns
 */
function addRequestLogger(appLogger: Logger, ignorePaths: RegExp[] = []): RequestHandler {
  const requestFilter = (req, propName): unknown => {
    if (propName === 'headers') {
      return { ...req[propName], cookie: '<redacted>' };
    }
    return req[propName];
  };
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
function buildBackendServer(port: number, hostBinding: string): Server {
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

  return app.listen(port, hostBinding, () => appLogger.info(`Application backend listening on ${hostBinding} on port ${port}`));
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
function buildFrontendServer(port: number, hostBinding: string, config: RouterConfig): Server {
  const appLogger = logger.child({ application: 'frontend' });
  const app = express();
  app.use(addRequestId(appLogger));
  app.use(addRequestLogger(appLogger));

  // currently, only service requests are timed (for the frontend)
  app.use(logForRoutes('timing.frontend-request.start', 'allow', [cmrCollectionReader.collectionRegex]));

  app.use(favicon(path.join(__dirname, '..', 'public/assets/images', 'favicon.ico')));

  // Setup mustache as a templating engine for HTML views
  app.engine('mustache.html', mustacheExpress());
  app.set('view engine', 'mustache.html');
  app.set('views', path.join(__dirname, 'views'));

  if (config.EXAMPLE_SERVICES !== 'false') {
    app.use('/example', exampleBackend.router());
  }
  app.use('/', router(config));
  // Error handlers that format errors outside of their routes / middleware need to be mounted
  // at the top level, not on a child router, or they get skipped.
  ogcCoveragesApi.handleOpenApiErrors(app);
  app.use(errorHandler);

  return app.listen(port, hostBinding, () => appLogger.info(`Application frontend listening on ${hostBinding} on port ${port}`));
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
  frontend: Server;
  backend: Server;
  workReaper: WorkReaper;
  workFailer: WorkFailer;
} {

  // Log unhandled promise rejections and do not crash the node process
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  const appPort = +config.PORT;
  const backendPort = +config.BACKEND_PORT;

  // Setup the frontend server to handle client requests
  const frontend = buildFrontendServer(appPort, config.HOST_BINDING, config);

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to accept callbacks from backend services
  const backend = buildBackendServer(backendPort, config.HOST_BINDING);

  let workReaper;
  if (config.startWorkReaper !== 'false') {
    const reaperConfig = {
      logger: logger.child({ application: 'work-reaper' }),
    };
    workReaper = new WorkReaper(reaperConfig);
    workReaper.start();
  }

  let workFailer;
  if (config.startWorkFailer !== 'false') {
    const failerConfig = {
      logger: logger.child({ application: 'work-failer' }),
    };
    workFailer = new WorkFailer(failerConfig);
    workFailer.start();
  }

  return { frontend, backend, workReaper, workFailer };
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
