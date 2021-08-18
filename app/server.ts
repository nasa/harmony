import express, { Response, NextFunction, RequestHandler } from 'express';
import mustacheExpress from 'mustache-express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import { promisify } from 'util';
import errorHandler from 'middleware/error-handler';
import router, { RouterConfig } from 'routers/router';
import RequestContext from 'models/request-context';
import { Server } from 'http';
import HarmonyRequest from 'models/harmony-request';
import { Logger } from 'winston';
import * as ogcCoveragesApi from './frontends/ogc-coverages';
import serviceResponseRouter from './routers/service-response-router';
import logger, { ignorePaths, inIgnoreList } from './util/log';
import * as exampleBackend from '../example/http-backend';
import WorkflowTerminationListener from './workers/workflow-termination-listener';
import JobReaper from './workers/job-reaper';

/**
 * Returns middleware to add a request specific logger
 *
 * @param appLogger - Request specific application logger
 */
function addRequestLogger(appLogger: Logger): RequestHandler {
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
    ignoreRoute(req) { return inIgnoreList(req.url, ignorePaths); },
  });
}

/**
 * Returns middleware to set a requestID for a request if the request does not already
 * have one set. Also adds requestUrl to the logger info object.
 *
 * @param appLogger - Request specific application logger
 * @param appName - The name of the listener - either frontend or backend
 */
function addRequestId(appLogger: Logger, appName: string): RequestHandler {
  return (req: HarmonyRequest, res: Response, next: NextFunction): void => {
    const requestId = req.context?.id || uuid();
    const requestUrl = req.url;
    const context = new RequestContext(requestId);
    context.logger = appLogger.child({ requestId, requestUrl });
    context.logger.info(`timing.${appName}-request.start`);
    req.context = context;
    next();
  };
}

/**
 * Builds an express server with appropriate logging and starts the backend server
 * listening on the provided port.
 *
 * @param port - The port the server should listen on
 * @returns The running express application
 */
function buildBackendServer(port: number): Server {
  const appLogger = logger.child({ application: 'backend' });
  const setRequestId = (req: HarmonyRequest, res: Response, next: NextFunction): void => {
    const { requestId } = req.params;

    const context = new RequestContext(requestId);
    req.context = context;
    next();
  };

  const app = express();

  app.use('/service/:requestId/*', setRequestId);
  app.use(addRequestId(appLogger, 'backend'));
  app.use(addRequestLogger(appLogger));

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));
  app.use('/service', serviceResponseRouter());
  app.get('/', ((req, res) => res.send('OK')));
  app.use(errorHandler);

  return app.listen(port, '0.0.0.0', () => appLogger.info(`Application backend listening on port ${port}`));
}

/**
 * Builds an express server with appropriate logging and routing and starts the frontend server
 * listening on the provided port.
 *
 * @param port - The port the server should listen on
 * @param config - Config that controls whether certain middleware will be used
 * @returns The running express application
 */
function buildFrontendServer(port: number, config: RouterConfig): Server {
  const appLogger = logger.child({ application: 'frontend' });
  const app = express();

  app.use(addRequestId(appLogger, 'frontend'));
  app.use(addRequestLogger(appLogger));

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));

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

  return app.listen(port, '0.0.0.0', () => appLogger.info(`Application frontend listening on port ${port}`));
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
  workflowTerminationListener: WorkflowTerminationListener;
  jobReaper: JobReaper;
} {
  const appPort = +config.PORT;
  const backendPort = +config.BACKEND_PORT;

  // Setup the frontend server to handle client requests
  const frontend = buildFrontendServer(appPort, config);

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to accept callbacks from backend services
  const backend = buildBackendServer(backendPort);

  let listener;
  if (config.startWorkflowTerminationListener !== 'false') {
    const workflowTerminationListenerConfig = {
      namespace: 'argo',
      logger: logger.child({ application: 'workflow-events' }),
    };
    listener = new WorkflowTerminationListener(workflowTerminationListenerConfig);
    listener.start();
  }

  let reaper;
  if (config.startJobReaper !== 'false') {
    const reaperConfig = {
      logger: logger.child({ application: 'workflow-events' }),
    };
    reaper = new JobReaper(reaperConfig);
    reaper.start();
  }

  return { frontend, backend, workflowTerminationListener: listener, jobReaper: reaper };
}

/**
 * Stops the express servers created and returned by the start() method
 *
 * @param frontend - http.Server object as returned by start()
 * @param backend - http.Server object as returned by start()
 * @param workflowTerminationListener - listener for workflow termination events
 * @param jobReaper - service that checks for orphan jobs and marks them as canceled
 * @returns A promise that completes when the servers close
 */
export async function stop({
  frontend,
  backend,
  workflowTerminationListener,
  jobReaper }): Promise<void> {
  await Promise.all([
    promisify(frontend.close.bind(frontend))(),
    promisify(backend.close.bind(backend))(),
    workflowTerminationListener?.stop(),
    jobReaper?.stop(),
  ]);
}

if (require.main === module) {
  start(process.env);
}
