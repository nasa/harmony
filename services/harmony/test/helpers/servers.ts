import { before, after } from 'mocha';
import { stub } from 'sinon';
import * as harmony from '../../app/server';
import env from '../../app/util/env';
import { stubEdlRequest, token, unstubEdlRequest } from './auth';

process.env.EXAMPLE_SERVICES = 'true';

/**
 * Add before / after hooks to start up and shut down Harmony's servers
 * on ephemeral ports
 *
 * Important for tests: any tests that make a request and follow a redirect to the job status
 * page expect that the job can be shared with any user. If a job cannot be shared (collection
 * is not public or has a EULA), you must set skipEarthdataLogin: false, supply a username
 * when making the request, and supply the same username when following the redirect to the
 * job status.
 *
 * Example:
 * `hookServersStartStop({ skipEarthdataLogin: false });`
 * `hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });`
 * `hookRedirect('joe');`
 *
 * @param opts - Options to pass to the server start method
 * @param stubOAuthClientCredentialsReq - Whether to replace OAuth client_credentials API calls to EDL
 * with a stub that returns a fake_access token
 */
export default function hookServersStartStop(opts = { skipEarthdataLogin: true }, stubOAuthClientCredentialsReq = true): void {
  let servers = null;
  before(async function () {
    // Skip Earthdata Login unless the test says to do otherwise
    const skipEdl = opts.skipEarthdataLogin ? 'true' : 'false';
    // Start Harmony on a random open port
    servers = await harmony.start({
      EXAMPLE_SERVICES: 'true',
      skipEarthdataLogin: skipEdl,
      startWorkflowTerminationListener: 'false',
      startWorkReaper: 'false',
      startWorkFailer: 'false',
      startWorkItemUpdateQueueProcessor: 'false',
      // Hardcoded to 4000 to match the port in the url for the example HTTP service in services.yml
      PORT: '4000',
      BACKEND_PORT: '0',
    });
    this.frontend = servers.frontend;
    this.backend = servers.backend;

    stub(env, 'callbackUrlRoot').get(() => `http://127.0.0.1:${servers.backend.address().port}`);
    const locallyDeployedServices = 'giovanni-adapter,harmony-service-example,' +
      'harmony-netcdf-to-zarr,var-subsetter,swath-projector,harmony-gdal-adapter,' +
      'podaac-concise,sds-maskfill,trajectory-subsetter,podaac-l2-subsetter,harmony-regridder,' +
      'hybig,geoloco,stitchee,batchee,hoss,subset-band-name';
    stub(env, 'locallyDeployedServices').get(() => locallyDeployedServices);
    process.env.OAUTH_REDIRECT_URI = `http://127.0.0.1:${servers.frontend.address().port}/oauth2/redirect`;

    if (stubOAuthClientCredentialsReq) {
      stubEdlRequest(
        '/oauth/token',
        { grant_type: 'client_credentials' },
        token({ accessToken: 'fake_access' }),
      );
    }
  });
  after(async function () {
    await harmony.stop(servers);
    delete this.frontend;
    delete this.backend;
    if (stubOAuthClientCredentialsReq) {
      unstubEdlRequest();
    }
  });
}
