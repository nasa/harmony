process.env.EXAMPLE_SERVICES = 'true';

const { before, after } = require('mocha');
const harmony = require('../../app/server');

/**
 * Add before / after hooks to start up and shut down Harmony's servers
 * on ephemeral ports
 *
 * @param {object} opts Options to pass to the server start method
 * @returns {void}
 */
function hookServersStartStop(opts = {}) {
  let servers = null;
  before(function () {
    // Skip Earthdata Login unless the test says to do otherwise
    const skipEdl = opts.skipEarthdataLogin === undefined ? true : opts.skipEarthdataLogin;
    // Start Harmony on a random open port
    servers = harmony.start({ PORT: 0, BACKEND_PORT: 0, EXAMPLE_SERVICES: 'true', skipEarthdataLogin: skipEdl });
    this.frontend = servers.frontend;
    this.backend = servers.backend;
  });
  after(async function () {
    await harmony.stop(servers);
    delete this.frontend;
    delete this.backend;
  });
}

module.exports = {
  hookServersStartStop,
};
