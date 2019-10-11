const express = require('express');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const wmsFrontend = require('../frontends/wms');
const wcsFrontend = require('../frontends/wcs');
const cmrCollectionReader = require('../middleware/cmr-collection-reader');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');
const { NotFoundError } = require('../util/errors');
const services = require('../models/services');

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
    req.logger = req.logger.child({ component: scope });
    try {
      req.logger.info('Invoking middleware');
      return await fn(req, res, next);
    } finally {
      req.logger.info('Completed middleware');
      req.logger = logger;
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
    try {
      if (!req.collections || req.collections.length === 0) {
        throw new NotFoundError('Services can only be invoked when a valid collection is supplied in the URL path before the service name');
      }
      // Attempts to grab an available backend for the requested operation.
      // If no such backend exists, this will throw, causing desirable 404s.
      if (!req.collections.every(services.isCollectionSupported)) {
        throw new NotFoundError('The requested service is not valid for the given collection');
      }
      await fn(req, res, next);
    } catch (e) {
      req.logger.error(e);
      next(e);
    }
  };
}
/**
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @returns {express.Router} A router which can respond to frontend service requests
 */
function router() {
  const result = express.Router();

  result.use(logged(earthdataLoginAuthorizer));
  result.use(logged(cmrCollectionReader));

  result.use('/wcs', service(logged(wcsFrontend)));
  result.use('/wms', service(logged(wmsFrontend)));

  result.use(logged(cmrGranuleLocator));

  result.get('/', (req, res) => res.status(200).send('ok'));
  result.get(/\/(wcs|wms)/, service(serviceInvoker));
  result.get('/*', () => { throw new NotFoundError('The requested page was not found'); });
  return result;
}

module.exports = router;
