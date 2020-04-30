import process from 'process';
import express from 'express';
import cookieParser from 'cookie-parser';

// Middleware requires in outside-in order
import earthdataLoginAuthorizer from 'middleware/earthdata-login-authorizer';
import wmsFrontend from 'frontends/wms';
import { getJobsListing, getJobStatus } from 'frontends/jobs';
import { getStacCatalog, getStacItem } from 'frontends/stac';
import { getServiceResult } from 'frontends/service-results';
import shapefileUpload from 'middleware/shapefile-upload';
import cmrGranuleLocator from 'middleware/cmr-granule-locator';
import setRequestId from 'middleware/request-id';
import shapefileConverter from 'middleware/shapefile-converter';
import { NotFoundError } from 'util/errors';
import * as eoss from 'frontends/eoss';
import * as ogcCoverageApi from 'frontends/ogc-coverages/index';
import { cloudAccessJson, cloudAccessSh } from 'frontends/cloud-access';
import { landingPage } from 'frontends/landing-page';
import serviceInvoker from 'backends/service-invoker';
// TODO fix this
// import wcsFrontend from 'frontends/wcs';
const wcsFrontend = {};

import cmrCollectionReader = require('middleware/cmr-collection-reader');

/**
 * Given an Express.js middleware handler function, returns another
 * Express.js handler that wraps the input function with logging
 * information and ensures the logger accessed by the input function
 * describes the middleware that produced it.
 *
 * @param {Function} fn The middleware handler to wrap with logging
 * @returns {Function} The handler wrapped with logging information
 */
function logged(fn) {
  const scope = `middleware.${fn.name}`;
  return async (req, res, next) => {
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
 * @param {Function} fn The service handler
 * @returns {Function} The handler wrapped in validation
 * @throws {NotFoundError} If there are no collections in the request
 */
function service(fn) {
  return async (req, res, next) => {
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
 * @param {string} path The URL path
 * @returns {string} The path prefixed by one or more collection IDs
 */
function collectionPrefix(path) {
  const result = new RegExp(cmrCollectionReader.collectionRegex.source + path);
  return result;
}

// Regex for any routes that we expect to begin with a CMR collection identifier
const collectionRoute = /^(\/(?!docs).*\/)(wms|wcs|eoss|ogc-api-coverages)/;

/**
 * Validates that routes which require a collection identifier are using the correct
 * format for a collection identifier.
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {function} next The next function in the call chain
 * @returns {void}
 */
function validateCollectionRoute(req, res, next) {
  const { path } = req;
  const collectionRouteMatch = path.match(collectionRoute);
  if (collectionRouteMatch) {
    if (!collectionRouteMatch[1].match(cmrCollectionReader.collectionRegex)) {
      const badId = collectionRouteMatch[1].substring(1, collectionRouteMatch[1].length - 1);
      next(new NotFoundError(`Route must include a CMR collection identifier. ${badId} is not a valid collection identifier.`));
    }
  }
  next();
}

/**
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @param {string} skipEarthdataLogin Opt to skip Earthdata Login
 * @returns {express.Router} A router which can respond to frontend service requests
 */
export default function router({ skipEarthdataLogin }) {
  const result = express.Router();

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('The "COOKIE_SECRET" environment variable must be set to a random secret string.');
  }

  result.use(cookieParser(secret));

  // Handle multipart/form-data (used for shapefiles). Files will be uploaded to
  // a bucket.
  result.post(collectionPrefix('(ogc-api-coverages)'), shapefileUpload());

  if (`${skipEarthdataLogin}` !== 'true') {
    result.use(logged(earthdataLoginAuthorizer([
      cmrCollectionReader.collectionRegex,
      '/jobs*',
      '/service-results/*',
      '/cloud-access*',
      '/stac*',
    ])));
  }

  // Routes and middleware not dealing with service requests
  result.get('/service-results/:bucket/:key(*)', getServiceResult);

  // Routes and middleware for handling service requests
  result.use(logged(validateCollectionRoute));
  result.use(logged(cmrCollectionReader));

  ogcCoverageApi.addOpenApiRoutes(result);
  result.use(collectionPrefix('wcs'), service(logged(wcsFrontend)));
  result.use(collectionPrefix('wms'), service(logged(wmsFrontend)));
  eoss.addOpenApiRoutes(result);

  result.use(/^\/(wms|wcs|eoss|ogc-api-coverages)/, (req, res, next) => {
    next(new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name.'));
  });

  result.use(logged(shapefileConverter));
  result.use(logged(cmrGranuleLocator));
  result.use(logged(setRequestId));

  result.get('/', landingPage);
  result.get(collectionPrefix('(wms|wcs|eoss|ogc-api-coverages)'), service(serviceInvoker));
  result.post(collectionPrefix('(ogc-api-coverages)'), service(serviceInvoker));
  result.get('/jobs', getJobsListing);
  result.get('/jobs/:jobID', getJobStatus);
  result.get('/cloud-access', cloudAccessJson);
  result.get('/cloud-access.sh', cloudAccessSh);
  result.get('/stac/:jobId', getStacCatalog);
  result.get('/stac/:jobId/:itemIndex', getStacItem);
  result.get('/*', () => { throw new NotFoundError('The requested page was not found.'); });
  result.post('/*', () => { throw new NotFoundError('The requested POST page was not found.'); });
  return result;
}
