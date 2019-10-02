const express = require('express');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const wmsFrontend = require('../frontends/wms');
const wcsFrontend = require('../frontends/wcs');
const cmrCollectionReader = require('../middleware/cmr-collection-reader');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');

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
 * Creates and returns an express.Router instance that has the middleware
 * and handlers necessary to respond to frontend service requests
 *
 * @returns {express.Router} A router which can respond to frontend service requests
 */
function router() {
  const result = express.Router();

  result.use(logged(earthdataLoginAuthorizer));
  result.use(logged(cmrCollectionReader));

  result.use('/wcs', logged(wcsFrontend));
  result.use('/wms', logged(wmsFrontend));

  result.use(logged(cmrGranuleLocator));

  result.get('/', (req, res) => res.status(200).send('ok'));
  result.get('/*', serviceInvoker);
  return result;
}

module.exports = router;
