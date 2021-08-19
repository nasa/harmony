import { before, after } from 'mocha';
import { stub } from 'sinon';
import * as harmony from '../../app/server';
import env from '../../app/util/env';

process.env.EXAMPLE_SERVICES = 'true';

/**
 * Add before / after hooks to start up and shut down Harmony's servers
 * on ephemeral ports
 *
 * @param opts - Options to pass to the server start method
 */
export default function hookServersStartStop(opts = { skipEarthdataLogin: true }): void {
  let servers = null;
  before(async function () {
    // Skip Earthdata Login unless the test says to do otherwise
    const skipEdl = opts.skipEarthdataLogin ? 'true' : 'false';
    // Start Harmony on a random open port
    servers = await harmony.start({
      EXAMPLE_SERVICES: 'true',
      skipEarthdataLogin: skipEdl,
      startWorkflowTerminationListener: 'false',
      startJobReaper: 'false',
      startWorkReaper: 'false',
      // Hardcoded to 4000 to match the port in the url for the example HTTP service in services.yml
      PORT: '4000',
      BACKEND_PORT: '0',
    });
    this.frontend = servers.frontend;
    this.backend = servers.backend;
    stub(env, 'callbackUrlRoot').get(() => `http://localhost:${servers.backend.address().port}`);
    process.env.OAUTH_REDIRECT_URI = `http://localhost:${servers.frontend.address().port}/oauth2/redirect`;
  });
  after(async function () {
    await harmony.stop(servers);
    delete this.frontend;
    delete this.backend;
  });
}
