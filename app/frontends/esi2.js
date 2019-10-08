// Add some code
const express = require('express');
const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');

const version = 0;
const openApiPath = path.join(__dirname, '..', 'schemas', `esi2-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath);

const app = express();

initialize({
  app,
  apiDoc: openApiPath,
  operations: {
    getLandingPage: function (req, res) {
      res.append('Content-type', 'text/x-yaml');
      res.send(openApiContent);
    },
    getGranule: function (req, res) {
      res.send('Called getGranule\n');
    },
  },
});

app.listen(3002);
