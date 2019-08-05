const express = require('express');
//const reload = require('express-reload');
const winston = require('winston');
const router = require('./routers/router');

const app = express();
const port = 3000;

const logger = winston.createLogger({
    transports: [
      new winston.transports.Console()
    ]
  });

// Dev only
//app.use(reload(__dirname + '/devserver.js'));
app.use('/', router(logger));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));