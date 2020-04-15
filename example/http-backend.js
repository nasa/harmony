/**
 * Example of a service backend that communicates with Harmony over HTTP.
 *
 * Exposes a URL path that knows how to communicate with Harmony, in this case
 * "/example/harmony". In a real app, this could be any routable URL and could
 * coexist with other application URLs.  The endpoint receives a POST from
 * Harmony containing a Harmony JSON message.  The service then performs its
 * work to fulfill the request (in this case simple stubbed-out, echoing,
 * erroring, or redirecting behavior) and responds over HTTP.  The response
 * is one of:
 *   An HTTP error (4xx or 5xx) - Harmony will return the error to the user using
 *      the same response code and body as the service
 *   An HTTP redirect (300-399) - Harmony will redirect to the data pointed to in
 *      the Location header
 *   An HTTP response body - Harmony will convey the Content-Type and Content-Length
 *      to the user (or subsequent service) and stream the bytes received in the
 *      response body
 *
 * This example allows us to test and demonstrate all three.  It triggers off the
 * message's `format.crs` property to decide the correct behavior.  See documentation
 * for `handleHarmonyMessage` below for details.
 */

const express = require('express');
const { promisify } = require('util');
const winston = require('winston');
const request = require('request-promise');

// A mapping of request IDs to callback URLs for use in demonstrating and testing async requests.
const idsToCallbacks = {};

let callbackResolutions = [];

/**
 * Returns a promise that will resolve to the callback URL the next time the service is invoked
 * to allow exploration of what various callback options do.
 *
 * @returns {Promise<string>} a promise that will resolve to the next callback URL
 */
function getNextCallback() {
  return new Promise((resolve) => { callbackResolutions.push(resolve); });
}

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

  if (!body || !body.format) {
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
  } else if (!body.isSynchronous) {
    idsToCallbacks[body.requestId] = body.callback;
    for (const resolve of callbackResolutions) {
      resolve(body.callback);
    }
    callbackResolutions = [];
    // Asynchronous request.
    res.status(202).send('accepted');
  } else {
    res.type('application/json');
    res.send(req.rawBody);
  }
}

/**
 * Shows how to send asynchronous status.  Whenever something external sends a GET
 * request to this endpoint, we forward a status onto Harmony.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function sendAsyncHarmonyStatus(req, res) {
  const { id } = req.query;
  if (!id) {
    res.status(400).send('parameter "id" is required');
    return;
  }
  const callback = idsToCallbacks[id];
  if (!callback) {
    res.status(400).send(`no callback found for id="${id}"`);
    return;
  }
  const result = await request.post({ url: `${callback}/response`, qs: req.query });
  res.json({ status: result.status, text: result.body });
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

  // Endpoint to provide status updates for async services
  result.get('/status', sendAsyncHarmonyStatus);

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

module.exports = { start, stop, router, getNextCallback };

if (require.main === module) {
  start(process.env);
}
