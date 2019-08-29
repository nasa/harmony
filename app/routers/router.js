const express = require('express');
const expressWinston = require('express-winston');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const wmsFrontend = require('../frontends/wms');
const wcsFrontend = require('../frontends/wcs');
const cmrCollectionReader = require('../middleware/cmr-collection-reader');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');

const logged = (fn) => {
    const scope = `middleware.${fn.name}`;
    return async (req, res, next) => {
        const logger = req.logger;
        req.logger = req.logger.child({component: scope});
        const profiler = req.logger.startTimer();
        try {
            req.logger.info('Invoking middleware');
            return await fn(req, res, next);
        }
        finally {
            profiler.done({ message: 'Completed middleware' });
            req.logger = logger;
        }
    };
};

module.exports = function (logger) {
    const router = express.Router();

    // TODO: Root-level stuff that should be moved out
    const addRequestLogger = expressWinston.logger({
        winstonInstance: logger,
        dynamicMeta: function(req, res) { return { requestId: req.id }; }
    });

    function addRequestId(req, res, next) {
        req.id = Math.floor(Math.random() * 1000000);;
        req.logger = logger.child({ requestId: req.id });
        next();
    }

    router.use(addRequestId);
    router.use(addRequestLogger);
    // TODO: Root-level stuff that should be moved out

    router.use(logged(earthdataLoginAuthorizer));
    router.use(logged(cmrCollectionReader))

    router.use("/wcs", logged(wcsFrontend));
    router.use("/wms", logged(wmsFrontend));

    router.use(logged(cmrGranuleLocator));

    router.get('/*', (req, res) => res.send("Hi!"));
    return router;
};
