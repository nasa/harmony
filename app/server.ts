import express from 'express';
import mustacheExpress from 'mustache-express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import { promisify } from 'util';
import errorHandler from 'middleware/error-handler';
import router from 'routers/router';
import RequestContext from 'models/request-context';
import { Server } from 'http';
import * as ogcCoveragesApi from './frontends/ogc-coverages';
import serviceResponseRouter from './routers/service-response-router';
import logger from './util/log';
import * as exampleBackend from '../example/http-backend';
import WorkflowTerminationListener from './workers/workflow-termination-listener';
import JobReaper from './workers/job-reaper';

/**
 * Builds an express server with appropriate logging and default routing and starts the server
 * listening on the provided port.
 *
 * @param name - The name of the server, as identified in logs
 * @param port - The port the server should listen on
 * @param setupFn - A function that takes an express app and adds non-default behavior
 * @returns The running express application
 */
function buildServer(name, port, setupFn): Server {
  const appLogger = logger.child({ application: name });

  const addRequestId = (req, res, next): void => {
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
  const appPort = config.PORT || 3000;
  const backendPort = config.BACKEND_PORT || 3001;

  // Setup the frontend server to handle client requests
  const frontend = buildServer('frontend', appPort, (app: express.Application) => {
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
  });

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to accept callbacks from backend services
  const backend = buildServer('backend', backendPort, (app) => {
    app.use('/service', serviceResponseRouter());
    app.get('/', ((req, res) => res.send('OK')));
  });

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
