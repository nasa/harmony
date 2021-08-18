import process from 'process';
import express, { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import log from '../util/log';

// Middleware requires in outside-in order
import shapefileUpload from '../middleware/shapefile-upload';
import earthdataLoginTokenAuthorizer from '../middleware/earthdata-login-token-authorizer';
import earthdataLoginOauthAuthorizer from '../middleware/earthdata-login-oauth-authorizer';
import admin from '../middleware/admin';
import wmsFrontend from '../frontends/wms';
import { getJobsListing, getJobStatus, cancelJob, getJobsForWorkflowUI, getJobForWorkflowUI, getWorkItemsForWorkflowUI } from '../frontends/jobs';
import { getStacCatalog, getStacItem } from '../frontends/stac';
import { getServiceResult } from '../frontends/service-results';
import cmrGranuleLocator from '../middleware/cmr-granule-locator';
import parameterValidation from '../middleware/parameter-validation';
import chooseService from '../middleware/service-selection';
import shapefileConverter from '../middleware/shapefile-converter';
import { NotFoundError } from '../util/errors';
import * as eoss from '../frontends/eoss';
import * as ogcCoverageApi from '../frontends/ogc-coverages/index';
import { cloudAccessJson, cloudAccessSh } from '../frontends/cloud-access';
import landingPage from '../frontends/landing-page';
import getVersions from '../frontends/versions';
import serviceInvoker from '../backends/service-invoker';
import HarmonyRequest, { addRequestContextToOperation } from '../models/harmony-request';

import cmrCollectionReader = require('../middleware/cmr-collection-reader');
import envVars = require('../util/env');

export interface RouterConfig {
  PORT?: string | number; // The port to run the frontend server on
  BACKEND_PORT?: string | number; // The port to run the backend server on
  CALLBACK_URL_ROOT?: string; // The base URL for callbacks to use
  // True if we should run example services, false otherwise.  Should be false
  // in production.  Defaults to true until we have real HTTP services.
  EXAMPLE_SERVICES?: string;
  skipEarthdataLogin?: string; // True if we should skip using EDL
}

/**
 * Given an Express.js middleware handler function, returns another
 * Express.js handler that wraps the input function with logging
 * information and ensures the logger accessed by the input function
 * describes the middleware that produced it.
 *
 * @param fn - The middleware handler to wrap with logging
 * @returns The handler wrapped with logging information
 */
function logged(fn: RequestHandler): RequestHandler {
  const scope = `middleware.${fn.name}`;
  return async (req: HarmonyRequest, res, next): Promise<void> => {
    const { logger } = req.context;
    const child = logger.child({ component: scope });
    req.context.logger = child;
    const startTime = new Date().getTime();
    try {
      child.debug('Invoking middleware');
      return await fn(req, res, next);
    } finally {
      const msTaken = new Date().getTime() - startTime;
      child.debug('Completed middleware', { durationMs: msTaken });
      if (req.context.logger === child) {
        // Other middlewares may have changed the logger.  This generally happens
        // when `next()` is an async call that the middleware doesn't await.  Note
        // this method does not perfectly guarantee the correct logger is always
        // used.  To do that, each middleware needs to set up and tear down its own
        // logger.
        req.context.logger = logger;
      }
    }
  };
}

/**
 * Returns a function that the incoming request is a valid service request before
 * invoking its handler.
 *
 * @param fn - The service handler
 * @returns The handler wrapped in validation
 * @throws NotFoundError - If there are no collections in the request
 */
function service(fn: RequestHandler): RequestHandler {
  return async (req: HarmonyRequest, res, next): Promise<void> => {
    const { logger } = req.context;
    const child = logger.child({ component: `service.${fn.name}` });
    req.context.logger = child;
    try {
      if (!req.collections || req.collections.length === 0) {
        throw new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name.');
      }
      child.info('Running service');
      await fn(req, res, next);
    } catch (e) {
      child.error(e);
      next(e);
    } finally {
      if (req.context.logger === child) {
        // See note in `logged`.  The logger may have changed during middleware execution
        req.context.logger = logger;
      }
    }
  };
}

/**
 * Given a path, returns a regular expression for that path prefixed by one or more collections
 *
 * @param path - The URL path
 * @returns The path prefixed by one or more collection IDs or short names
 */
function collectionPrefix(path: string): RegExp {
  const result = new RegExp(`.*/${path}`);
  return result;
}

const authorizedRoutes = [
  cmrCollectionReader.collectionRegex,
  '/jobs*',
  '/service-results/*',
  '/cloud-access*',
  '/stac*',
];

/**
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @param skipEarthdataLogin - Opt to skip Earthdata Login
 * @returns A router which can respond to frontend service requests
 */
export default function router({ skipEarthdataLogin = 'false' }: RouterConfig): express.Router {
  const result = express.Router();

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('The "COOKIE_SECRET" environment variable must be set to a random secret string.');
  }

  result.use(cookieParser(secret));

  result.use(express.static('public'));
  // JSON and YAML files under /schemas
  result.use('/schemas', express.static('app/schemas'));
  // Missing files under schemas not interpreted as service calls
  result.use('/schemas', (req, res, next) => next(new NotFoundError()));

  // Handle multipart/form-data (used for shapefiles). Files will be uploaded to
  // a bucket.
  result.post(collectionPrefix('(ogc-api-coverages)'), shapefileUpload());

  result.use(logged(earthdataLoginTokenAuthorizer(authorizedRoutes)));

  if (`${skipEarthdataLogin}` !== 'true') {
    result.use(logged(earthdataLoginOauthAuthorizer(authorizedRoutes)));
  }

  if (envVars.adminGroupId) {
    result.use('/admin/*', admin);
  } else {
    // Prevent misconfiguration granting unintended access
    log.warn('ADMIN_GROUP_ID is not set.  The admin interface will not be available');
    result.use('/admin/*', (req, res, next) => next(new NotFoundError()));
  }

  // Routes and middleware not dealing with service requests
  result.get('/service-results/:bucket/:key(*)', getServiceResult);

  // Routes and middleware for handling service requests
  result.use(logged(cmrCollectionReader));

  ogcCoverageApi.addOpenApiRoutes(result);
  result.use(collectionPrefix('wms'), service(logged(wmsFrontend)));
  eoss.addOpenApiRoutes(result);

  result.use(/^\/(wms|eoss|ogc-api-coverages)/, (req, res, next) => {
    next(new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name.'));
  });
  result.use(logged(shapefileConverter));
  result.use(logged(parameterValidation));
  result.use(logged(chooseService));
  result.use(logged(cmrGranuleLocator));
  result.use(logged(addRequestContextToOperation));

  result.get('/', landingPage);
  result.get('/versions', getVersions);
  result.use('/docs/api', swaggerUi.serve, swaggerUi.setup(yaml.load(ogcCoverageApi.openApiContent), { customJs: '/analytics-tag.js' }));
  result.get(collectionPrefix('(wms|eoss|ogc-api-coverages)'), service(serviceInvoker));
  result.post(collectionPrefix('(ogc-api-coverages)'), service(serviceInvoker));
  result.get('/jobs', getJobsListing);
  result.get('/jobs/:jobID', getJobStatus);
  result.post('/jobs/:jobID/cancel', cancelJob);
  result.get('/workflow-ui/jobs', getJobsForWorkflowUI);
  result.get('/workflow-ui/jobs/:jobID', getJobForWorkflowUI);
  result.get('/workflow-ui/jobs/table/:jobID', getWorkItemsForWorkflowUI);
  result.get('/admin/jobs', getJobsListing);
  result.get('/admin/jobs/:jobID', getJobStatus);
  result.post('/admin/jobs/:jobID/cancel', cancelJob);
  result.get('/admin/workflow-ui/jobs', getJobsForWorkflowUI);
  result.get('/admin/workflow-ui/jobs/:jobID', getJobForWorkflowUI);
  result.get('/admin/workflow-ui/jobs/table/:jobID', getWorkItemsForWorkflowUI);

  // Allow canceling with a GET in addition to POST to workaround issues with redirects using EDL
  result.get('/jobs/:jobID/cancel', cancelJob);
  result.get('/admin/jobs/:jobID/cancel', cancelJob);

  result.get('/cloud-access', cloudAccessJson);
  result.get('/cloud-access.sh', cloudAccessSh);
  result.get('/stac/:jobId', getStacCatalog);
  result.get('/stac/:jobId/:itemIndex', getStacItem);
  result.get('/*', () => { throw new NotFoundError('The requested page was not found.'); });
  result.post('/*', () => { throw new NotFoundError('The requested POST page was not found.'); });
  return result;
}
