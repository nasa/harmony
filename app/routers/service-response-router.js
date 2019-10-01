const express = require('express');
const bodyParser = require('body-parser');
const { responseHandler } = require('../backends/service-response');

/**
 * Creates and returns an express.Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns {express.Router} A router which can respond to backend services
 */
function router() {
  const result = express.Router();

  result.use(bodyParser.raw({ type: '*/*' }));

  result.post('/:uuid/response', responseHandler);
  return result;
}

module.exports = router;
