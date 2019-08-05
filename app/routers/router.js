const express = require('express');
const expressWinston = require('express-winston');

// Middleware requires in outside-in order
const earthdataLoginAuthorizer = require('../middleware/earthdata-login-authorizer');
const contentNegotiator = require('../middleware/content-negotiator');
const requestValidator = require('../middleware/request-validator');
const backendResolver = require('../middleware/backend-resolver');
const cmrGranuleLocator = require('../middleware/cmr-granule-locator');
const asyncifier = require('../middleware/asyncifier');
const serviceInvoker = require('../middleware/service-invoker');

const middleware = [
    earthdataLoginAuthorizer,
    contentNegotiator,
    requestValidator,
    backendResolver,
    cmrGranuleLocator,
    asyncifier,
    serviceInvoker
];

const addMiddlewareLogging = (fn) => {
    const scope = `middleware.${fn.name}`;
    return (req, res, next) => {
        const logger = req.logger;
        try {
            req.logger.profile(scope);
            req.logger = req.logger.child({component: scope});
            return fn(req, res, next);
        }
        finally {
            req.logger = logger;
            req.logger.profile(scope);
        }
    };
};

module.exports = function (logger) {
    const router = express.Router();

    router.use(expressWinston.logger({ winstonInstance: logger }));
    router.use(function(req, res, next) {
        req.logger = logger.child({ requestId: Math.floor(Math.random() * 1000000)});
        next();
    });

    for (const middlewareFn of middleware) {
        router.use(addMiddlewareLogging(middlewareFn));
    }
    
    router.get('/', (req, res) => res.send("Hi!"));
    return router;
};
