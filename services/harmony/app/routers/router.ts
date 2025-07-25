import cookieParser from 'cookie-parser';
import express, { json, RequestHandler } from 'express';
import asyncHandler from 'express-async-handler';
import * as yaml from 'js-yaml';
import process from 'process';
import swaggerUi from 'swagger-ui-express';

import serviceInvoker from '../backends/service-invoker';
import { getCollectionCapabilitiesJson } from '../frontends/capabilities';
import { cloudAccessJson, cloudAccessSh } from '../frontends/cloud-access';
import { setLogLevel } from '../frontends/configuration';
import docsPage from '../frontends/docs/docs';
import { getAdminHealth, getHealth } from '../frontends/health';
import {
  cancelJob, cancelJobs, getJobsListing, getJobStatus, pauseJob, pauseJobs, resumeJob, resumeJobs,
  skipJobPreview, skipJobsPreview,
} from '../frontends/jobs';
import { addJobLabels, deleteJobLabels } from '../frontends/labels';
import landingPage from '../frontends/landing-page';
import * as ogcCoverageApi from '../frontends/ogc-coverages/index';
import * as ogcEdrApi from '../frontends/ogc-edr/index';
import getRequestMetrics from '../frontends/request-metrics';
import { getRetryStatistics } from '../frontends/retry-stats';
import {
  getDeploymentLogs, getServiceDeployment, getServiceDeployments, getServiceDeploymentsState,
  getServiceImageTag, getServiceImageTags, setServiceDeploymentsState, updateServiceImageTag,
} from '../frontends/service-image-tags';
import { getServiceResult } from '../frontends/service-results';
import { getStacCatalog, getStacItem } from '../frontends/stac';
import { getStagingBucketPolicy } from '../frontends/staging-bucket-policy';
import getVersions from '../frontends/versions';
import wmsFrontend from '../frontends/wms';
import {
  getJob, getJobLinks, getJobs, getJobsTable, getWorkItemLogs, getWorkItemsTable,
  getWorkItemTableRow, redirectWithoutTrailingSlash, retry,
} from '../frontends/workflow-ui';
import cmrGranuleLocator from '../middleware/cmr-granule-locator';
import {
  postServiceConcatenationHandler, preServiceConcatenationHandler,
} from '../middleware/concatenation';
import earthdataLoginOauthAuthorizer from '../middleware/earthdata-login-oauth-authorizer';
import earthdataLoginSkipped from '../middleware/earthdata-login-skipped';
import earthdataLoginTokenAuthorizer from '../middleware/earthdata-login-token-authorizer';
import extendDefault from '../middleware/extend';
import { externalValidation } from '../middleware/external-validation';
import handleJobIDParameter from '../middleware/job-id';
import handleLabelParameter from '../middleware/label';
import parameterValidation from '../middleware/parameter-validation';
import { admin, core } from '../middleware/permission-groups';
import validateRestrictedVariables from '../middleware/restricted-variables';
import chooseService from '../middleware/service-selection';
import shapefileConverter from '../middleware/shapefile-converter';
// Middleware requires in outside-in order
import shapefileUpload from '../middleware/shapefile-upload';
import { setUmmVisForCollections } from '../middleware/umm-vis';
import HarmonyRequest, { addRequestContextToOperation } from '../models/harmony-request';
import env from '../util/env';
import { NotFoundError } from '../util/errors';
import { parseGridMiddleware } from '../util/grids';
import log from '../util/log';
import { validateAndSetVariables } from '../util/variables';

import cmrCollectionReader = require('../middleware/cmr-collection-reader');
import cmrUmmCollectionReader = require('../middleware/cmr-umm-collection-reader');
export interface RouterConfig {
  PORT?: string | number; // The port to run the frontend server on
  BACKEND_PORT?: string | number; // The port to run the backend server on
  CALLBACK_URL_ROOT?: string; // The base URL for callbacks to use
  // True if we should run example services, false otherwise.  Should be false
  // in production.  Defaults to true until we have real HTTP services.
  EXAMPLE_SERVICES?: string;
  USE_EDL_CLIENT_APP?: string; // True if we use the EDL client app
  USE_HTTPS?: string; // True if the server should use https
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
      child.silly('Invoking middleware');
      await fn(req, res, next);
    } finally {
      const msTaken = new Date().getTime() - startTime;
      child.silly('Completed middleware', { durationMs: msTaken });
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
      if (!req.context.collections || req.context.collections.length === 0) {
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
  '/admin*',
  '/capabilities*',
  '/cloud-access*',
  '/configuration*',
  '/jobs*',
  '/logs*',
  '/deployment-logs*',
  '/service-results/*',
  '/workflow-ui*',
  '/service-image*',
  '/service-deployment*',
  '/ogc-api-edr/.*/collections/*',
  '/labels',
];

/**
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @param USE_EDL_CLIENT_APP - Opt to skip Earthdata Login
 * @returns A router which can respond to frontend service requests
 */
export default function router({ USE_EDL_CLIENT_APP = 'false' }: RouterConfig): express.Router {
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
  result.post(collectionPrefix('(ogc-api-coverages)'), asyncHandler(shapefileUpload()));

  if (`${USE_EDL_CLIENT_APP}` !== 'false') {
    result.use(logged(earthdataLoginTokenAuthorizer(authorizedRoutes)));
    result.use(logged(earthdataLoginOauthAuthorizer(authorizedRoutes)));
  } else {
    result.use(logged(earthdataLoginSkipped));
  }

  result.use('/core/*', core);
  if (env.adminGroupId) {
    result.use('/admin/*', admin);
  } else {
    // Prevent misconfiguration granting unintended access
    log.warn('ADMIN_GROUP_ID is not set.  The admin interface will not be available');
    result.use('/admin/*', (req, res, next) => next(new NotFoundError()));
  }

  // Routes and middleware not dealing with service requests
  result.get('/service-results/:bucket/public/:jobId/:workItemId/:remainingPath(*)', asyncHandler(getServiceResult));
  result.get('/service-results/:bucket/:remainingPath(*)', asyncHandler(getServiceResult));

  // Routes and middleware for handling service requests
  result.use(logged(cmrCollectionReader));

  ogcCoverageApi.addOpenApiRoutes(result);
  ogcEdrApi.addOpenApiRoutes(result);
  result.use(collectionPrefix('wms'), service(logged(wmsFrontend)));

  result.use(/^\/(wms|ogc-api-coverages)/, (req, res, next) => {
    next(new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name.'));
  });
  result.use(logged(shapefileConverter));
  result.use(handleLabelParameter);
  result.use(handleJobIDParameter);
  result.use(logged(parameterValidation));
  result.use(logged(parseGridMiddleware));
  result.use(logged(preServiceConcatenationHandler));
  result.use(logged(chooseService));
  result.use(logged(postServiceConcatenationHandler));
  result.use(logged(validateAndSetVariables));
  result.use(logged(validateRestrictedVariables));
  result.use(logged(setUmmVisForCollections));

  result.use(logged(cmrUmmCollectionReader));
  result.use(logged(cmrGranuleLocator));
  result.use(logged(addRequestContextToOperation));
  result.use(logged(extendDefault));
  result.use(logged(externalValidation));
  result.use(logged(redirectWithoutTrailingSlash));

  result.get('/', asyncHandler(landingPage));
  result.get('/versions', asyncHandler(getVersions));
  result.get('/docs', asyncHandler(docsPage));

  const coverageApiDoc = yaml.load(ogcCoverageApi.openApiContent);
  const edrApiDoc = yaml.load(ogcEdrApi.openApiContent);
  result.use('/docs/api', swaggerUi.serveFiles(coverageApiDoc), swaggerUi.setup(coverageApiDoc, { customJs: '/js/docs/analytics-tag.js' }));
  result.use('/docs/edr-api', swaggerUi.serveFiles(edrApiDoc), swaggerUi.setup(edrApiDoc, { customJs: '/js/docs/analytics-tag.js' }));

  result.get(collectionPrefix('wms'), asyncHandler(service(serviceInvoker)));
  result.get(/^.*?\/ogc-api-coverages\/.*?\/collections\/.*?\/coverage\/rangeset\/?$/, asyncHandler(service(serviceInvoker)));
  result.post(/^.*?\/ogc-api-coverages\/.*?\/collections\/.*?\/coverage\/rangeset\/?$/, asyncHandler(service(serviceInvoker)));
  result.get(/^\/ogc-api-edr\/.*?\/collections\/.*?\/(cube|area|position|trajectory)\/?$/, asyncHandler(service(serviceInvoker)));
  result.post(/^\/ogc-api-edr\/.*?\/collections\/.*?\/(cube|area|position|trajectory)\/?$/, asyncHandler(service(serviceInvoker)));

  result.get('/jobs', asyncHandler(getJobsListing));
  result.get('/jobs/:jobID', asyncHandler(getJobStatus));
  result.get('/admin/jobs', asyncHandler(getJobsListing));
  result.get('/admin/jobs/:jobID', asyncHandler(getJobStatus));

  result.post('/jobs/:jobID/cancel', asyncHandler(cancelJob));
  result.post('/admin/jobs/:jobID/cancel', asyncHandler(cancelJob));
  // Allow canceling/resuming/pausing with a GET in addition to POST to workaround issues
  // with redirects using EDL
  result.get('/jobs/:jobID/cancel', asyncHandler(cancelJob));
  result.get('/admin/jobs/:jobID/cancel', asyncHandler(cancelJob));

  result.post('/jobs/:jobID/resume', asyncHandler(resumeJob));
  result.post('/admin/jobs/:jobID/resume', asyncHandler(resumeJob));
  result.get('/jobs/:jobID/resume', asyncHandler(resumeJob));
  result.get('/admin/jobs/:jobID/resume', asyncHandler(resumeJob));

  result.post('/jobs/:jobID/skip-preview', asyncHandler(skipJobPreview));
  result.post('/admin/jobs/:jobID/skip-preview', asyncHandler(skipJobPreview));
  result.get('/jobs/:jobID/skip-preview', asyncHandler(skipJobPreview));
  result.get('/admin/jobs/:jobID/skip-preview', asyncHandler(skipJobPreview));

  result.post('/jobs/:jobID/pause', asyncHandler(pauseJob));
  result.post('/admin/jobs/:jobID/pause', asyncHandler(pauseJob));
  result.get('/jobs/:jobID/pause', asyncHandler(pauseJob));
  result.get('/admin/jobs/:jobID/pause', asyncHandler(pauseJob));

  const jsonParser = json();
  result.post('/jobs/cancel', jsonParser, asyncHandler(cancelJobs));
  result.post('/jobs/resume', jsonParser, asyncHandler(resumeJobs));
  result.post('/jobs/skip-preview', jsonParser, asyncHandler(skipJobsPreview));
  result.post('/jobs/pause', jsonParser, asyncHandler(pauseJobs));

  // job labels
  result.put('/labels', jsonParser, asyncHandler(addJobLabels));
  result.delete('/labels', jsonParser, asyncHandler(deleteJobLabels));

  result.get('/admin/request-metrics', asyncHandler(getRequestMetrics));
  result.get('/admin/retry-stats', asyncHandler(getRetryStatistics));

  result.get('/workflow-ui', asyncHandler(getJobs));
  result.get('/workflow-ui/:jobID', asyncHandler(getJob));
  result.get('/workflow-ui/:jobID/work-items', asyncHandler(getWorkItemsTable));
  result.get('/workflow-ui/:jobID/work-items/:id', asyncHandler(getWorkItemTableRow));
  result.get('/workflow-ui/:jobID/links', asyncHandler(getJobLinks));
  result.post('/workflow-ui/:jobID/:id/retry', asyncHandler(retry));
  result.post('/workflow-ui/jobs', jsonParser, asyncHandler(getJobsTable));

  result.get('/admin/workflow-ui', asyncHandler(getJobs));
  result.get('/admin/workflow-ui/:jobID', asyncHandler(getJob));
  result.get('/admin/workflow-ui/:jobID/work-items', asyncHandler(getWorkItemsTable));
  result.get('/admin/workflow-ui/:jobID/work-items/:id', asyncHandler(getWorkItemTableRow));
  result.get('/admin/workflow-ui/:jobID/links', asyncHandler(getJobLinks));
  result.post('/admin/workflow-ui/jobs', jsonParser, asyncHandler(getJobsTable));

  result.get('/logs/:jobID/:id', asyncHandler(getWorkItemLogs));
  result.get('/deployment-logs/:deploymentId', asyncHandler(getDeploymentLogs));

  result.get('/staging-bucket-policy', asyncHandler(getStagingBucketPolicy));

  result.get('/core/configuration/log-level', asyncHandler(setLogLevel));

  result.get('/capabilities', asyncHandler(getCollectionCapabilitiesJson));
  // Enable HTML view with HARMONY-1393
  // result.get('/capabilities.html', asyncHandler(getCollectionCapabilitiesHtml));
  result.get('/cloud-access', asyncHandler(cloudAccessJson));
  result.get('/cloud-access.sh', asyncHandler(cloudAccessSh));
  result.get('/stac/:jobId', asyncHandler(getStacCatalog));
  result.get('/stac/:jobId/:itemIndex', asyncHandler(getStacItem));

  result.get('/health', asyncHandler(getHealth));
  result.get('/admin/health', asyncHandler(getAdminHealth));

  // Kubernetes readiness probe for Harmony in a Box
  result.get('/readiness', async (_req, res, _next: Function): Promise<void> => {
    res.send('OK');
  });

  // service images
  result.get('/service-image-tag', asyncHandler(getServiceImageTags));
  result.get('/service-image-tag/:service', asyncHandler(getServiceImageTag));
  result.put('/service-image-tag/:service', jsonParser, asyncHandler(updateServiceImageTag));
  result.get('/service-deployment', asyncHandler(getServiceDeployments));
  result.get('/service-deployment/:id', asyncHandler(getServiceDeployment));
  result.get('/service-deployments-state', asyncHandler(getServiceDeploymentsState));
  result.put('/service-deployments-state', jsonParser, asyncHandler(setServiceDeploymentsState));

  result.get('/*', () => { throw new NotFoundError('The requested page was not found.'); });
  result.post('/*', () => { throw new NotFoundError('The requested POST page was not found.'); });
  return result;
}
