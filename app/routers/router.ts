const process = require('process');
const express = require('express');
const cookieParser = require('cookie-parser');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const wmsFrontend = require('../frontends/wms');
const wcsFrontend = require('../frontends/wcs');
const { getJobsListing, getJobStatus } = require('../frontends/jobs');
const { getServiceResult } = require('../frontends/service-results');
const cmrCollectionReader = require('../middleware/cmr-collection-reader');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');
const syncRequestDecider = require('../middleware/sync-request-decider');
const setRequestId = require('../middleware/request-id');
const { NotFoundError } = require('../util/errors');
const eoss = require('../frontends/eoss');
const ogcCoverageApi = require('../frontends/ogc-coverages');

const serviceInvoker = require('../backends/service-invoker');

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
    const { logger } = req;
    const child = logger.child({ component: scope });
    req.logger = child;
    const startTime = new Date().getTime();
    try {
      child.debug('Invoking middleware');
      return await fn(req, res, next);
    } finally {
      const msTaken = new Date().getTime() - startTime;
      child.debug('Completed middleware', { durationMs: msTaken });
      if (req.logger === child) {
        // Other middlewares may have changed the logger.  This generally happens
        // when `next()` is an async call that the middleware doesn't await.  Note
        // this method does not perfectly guarantee the correct logger is always
        // used.  To do that, each middleware needs to set up and tear down its own
        // logger.
        req.logger = logger;
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
    const { logger } = req;
    const child = logger.child({ component: `service.${fn.name}` });
    req.logger = child;
    try {
      if (!req.collections || req.collections.length === 0) {
        throw new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name');
      }
      child.info('Running service');
      await fn(req, res, next);
    } catch (e) {
      child.error(e);
      next(e);
    } finally {
      if (req.logger === child) {
        // See note in `logged`.  The logger may have changed during middleware execution
        req.logger = logger;
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

/**
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @param {string} skipEarthdataLogin Opt to skip Earthdata Login
 * @returns {express.Router} A router which can respond to frontend service requests
 */
function router({ skipEarthdataLogin }) {
  const result = express.Router();

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('The "COOKIE_SECRET" environment variable must be set to a random secret string.');
  }

  result.use(cookieParser(secret));

  if (`${skipEarthdataLogin}` !== 'true') {
    result.use(logged(earthdataLoginAuthorizer([cmrCollectionReader.collectionRegex, '/jobs*', '/service-results/*'])));
  }

  // Routes and middleware not dealing with service requests
  result.get('/service-results/:bucket/:key(*)', getServiceResult);

  // Routes and middleware for handling service requests
  result.use(logged(cmrCollectionReader));

  ogcCoverageApi.addOpenApiRoutes(result);
  result.use(collectionPrefix('wcs'), service(logged(wcsFrontend)));
  result.use(collectionPrefix('wms'), service(logged(wmsFrontend)));
  eoss.addOpenApiRoutes(result);

  result.use(/^\/(wms|wcs|eoss)/, (req, res, next) => {
    next(new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name'));
  });

  result.use(logged(cmrGranuleLocator));
  result.use(logged(syncRequestDecider));
  result.use(logged(setRequestId));

  result.get('/', (req, res) => res.status(200).send('ok'));
  result.get(collectionPrefix('(wms|wcs|eoss|ogc-api-coverages)'), service(serviceInvoker));
  result.get('/jobs', getJobsListing);
  result.get('/jobs/:jobId', getJobStatus);
  result.get('/*', () => { throw new NotFoundError('The requested page was not found'); });
  return result;
}

module.exports = router;
