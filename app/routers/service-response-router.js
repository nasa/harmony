const express = require('express');
const bodyParser = require('body-parser');
const { responseHandler } = require('../backends/service-response');

module.exports = function router() {
  const result = express.Router();

  result.use(bodyParser.raw({ type: '*/*' }));

  result.post('/:uuid/response', responseHandler);
  return result;
};
