import { before, after } from 'mocha';
import * as harmony from '../../app/server';

process.env.EXAMPLE_SERVICES = 'true';

/**
 * Add before / after hooks to start up and shut down Harmony's servers
 * on ephemeral ports
 *
 * @param {object} opts Options to pass to the server start method
 * @returns {void}
 */
export default function hookServersStartStop(opts = { skipEarthdataLogin: true }): void {
  let servers = null;
  before(function () {
    // Skip Earthdata Login unless the test says to do otherwise
    const skipEdl = opts.skipEarthdataLogin ? 'true' : 'false';
    // Start Harmony on a random open port
    servers = harmony.start({ EXAMPLE_SERVICES: 'true', skipEarthdataLogin: skipEdl });
    this.frontend = servers.frontend;
    this.backend = servers.backend;
  });
  after(async function () {
    await harmony.stop(servers);
    delete this.frontend;
    delete this.backend;
  });
}
