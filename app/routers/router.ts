const express = require('express');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const wmsFrontend = require('../frontends/wms');
const wcsFrontend = require('../frontends/wcs');
const cmrCollectionReader = require('../middleware/cmr-collection-reader');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');

const serviceInvoker = require('../backends/service-invoker');

const logged = (fn) => {
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
};

module.exports = function router() {
  const result = express.Router();

  result.use(logged(earthdataLoginAuthorizer));
  result.use(logged(cmrCollectionReader));

  result.use('/wcs', logged(wcsFrontend));
  result.use('/wms', logged(wmsFrontend));

  result.use(logged(cmrGranuleLocator));

  result.get('/', (req, res) => res.status(200).send('ok'));
  result.get('/*', serviceInvoker);
  return result;
};
