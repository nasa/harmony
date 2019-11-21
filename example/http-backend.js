const express = require('express');
const { promisify } = require('util');
const winston = require('winston');

/**
 * Express.js handler demonstrating an example Harmony handler.
 *
 * This has three possible behaviors it can demonstrate, which it switches on based on
 * the Harmony message's `format.crs` property, allowing clients to perform tests without
 * altering or reloading services.yml.
 *
 * format.crs = "ERROR:<code>": Return an HTTP error with the given <code> and message
 *   "An intentional error occurred"
 * format.crs = "REDIRECT": Return an HTTP redirect to the "/redirected" path, which clients
 *   can GET for a 200 response
 * Default: Return a 200 response containing the incoming message
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function handleHarmonyMessage(req, res) {
  const { body } = req;

  if (!body || !body.format || !body) {
    res.status(400).send('You must provide a valid Harmony JSON message');
    return;
  }

  const { crs } = body.format;

  if (crs && crs.startsWith('ERROR:')) {
    const code = parseInt(crs.replace('ERROR:', ''), 10);
    if (code < 400 || code >= 600) {
      res.status(400).send(`The provided error code ${code} is invalid`);
    } else {
      res.status(code).send('An intentional error occurred');
    }
  } else if (crs === 'REDIRECT') {
    res.redirect(303, '/example/redirected');
  } else {
    res.type('application/json');
    res.send(req.rawBody);
  }
}

/**
 * Creates and returns an express.Router instance that runs the example server, allowing
 * it to be mounted onto another express server
 *
 * @returns {express.Router} A router which can respond to example service requests
 */
function router() {
  const result = express.Router();

  // Parse JSON POST bodies automatically, stashing the original text in req.rawBody
  result.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

  // Endpoint to give to Harmony.  Note that other endpoints could be set up for general use
  result.post('/harmony', handleHarmonyMessage);

  // Endpoint we'll redirect to when requested
  result.get('/redirected', (req, res) => res.send('You were redirected!'));

  return result;
}

/**
 * Starts the example server
 *
 * @param {object} [config={}] An optional configuration object containing server config.
 *   When running this module using the CLI, the configuration is pulled from the environment.
 *   Config values:
 *     port: {number} The port to run the example server on (default: 3002)
 *
 * @returns {http.Server} The started server
 */
function start(config = {}) {
  const port = config.PORT || 3002;
  const app = express();

  app.use('/example', router());

  return app.listen(port, '0.0.0.0', () => winston.info(`Example application listening on port ${port}`));
}

/**
 * Stops the express server created and returned by the start() method
 *
 * @param {http.Server} server A running server as returned by start()
 * @returns {Promise<void>} A promise that completes when the server closes
 */
function stop(server) {
  return promisify(server.close.bind(server));
}

module.exports = { start, stop, router };

if (require.main === module) {
  start(process.env);
}
