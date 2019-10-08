const { before, after } = require('mocha');
const harmony = require('../../app/server');

/**
 * Add before / after hooks to start up and shut down Harmony's servers
 * on ephemeral ports
 *
 * @returns {void}
 */
function hookServersStartStop() {
  let servers = null;
  before(function () {
    // Start Harmony on a random open port
    servers = harmony.start({ port: 0, backendPort: 0 });
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
