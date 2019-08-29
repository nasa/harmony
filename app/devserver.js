const express = require('express');
const winston = require('winston');
const router = require('./routers/router');
var favicon = require('serve-favicon')
var path = require('path')

const app = express();
const port = 3000;

const logger = winston.createLogger({
    transports: [
      new winston.transports.Console()
    ]
  });

// Dev only
app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));
app.use('/', router(logger));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));