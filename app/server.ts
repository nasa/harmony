const express = require('express');
const winston = require('winston');
const expressWinston = require('express-winston');
const favicon = require('serve-favicon');
const path = require('path');
const uuid = require('uuid');
const url = require('url');
const serviceResponse = require('./backends/service-response');
const serviceResponseRouter = require('./routers/service-response-router');
const router = require('./routers/router');

const appPort = process.env.port || 3000;
const backendPort = process.env.backendPort || 3001;
const backendHost = process.env.backendHost || 'localhost';
const backendProtocol = (process.env.useHttps || backendHost !== 'localhost') ? 'https' : 'http';

function buildServer(name, port, setupFn) {
  const logger = winston.createLogger({
    defaultMeta: { application: name },
    transports: [
      new winston.transports.Console(),
    ],
  });

  const addRequestId = (req, res, next) => {
    req.id = uuid();
    req.logger = logger.child({ requestId: req.id });
    next();
  };

  const addRequestLogger = expressWinston.logger({
    winstonInstance: logger,
    dynamicMeta(req) { return { requestId: req.id }; },
  });

  const app = express();

  app.use(addRequestId);
  app.use(addRequestLogger);

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));

  if (setupFn) {
    setupFn(app);
  }

  app.listen(port, () => logger.info(`Application "${name}" listening on port ${port}`));
}

buildServer('frontend', appPort, (app) => {
  app.use('/', router());
});

buildServer('backend', backendPort, (app) => {
  app.use('/service', serviceResponseRouter());

  serviceResponse.configure({
    baseUrl: url.format({
      protocol: backendProtocol,
      hostname: backendHost,
      port: backendPort,
      pathname: '/service/',
    }),
  });
});
