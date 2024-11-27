import HarmonyRequest from '../models/harmony-request';
import env from '../util/env';

if (process.env.USE_EDL_CLIENT_APP === 'false' && !process.env.EDL_TOKEN) {
  throw new Error(
    'Earthdata Login configuration error: You must set EDL_TOKEN in the environment ' +
    'when USE_EDL_CLIENT_APP is false',
  );
}

/**
 * Builds Express.js middleware for bypassing EDL client authentication. This should only
 * be used for local testing and will limit harmony functionality to endpoints that do
 * not require an EDL client to perform checks. EDL token verification will not be
 * performed directly by the harmony app, but the EDL_TOKEN environment variable will
 * be passed to CMR and to download sites when trying to retrieve data at which point
 * those applications will validate the token.
 *
 * @returns Express.js middleware for doing EDL token authentication
 */
export default async function edlSkipped(req: HarmonyRequest, res, next): Promise<void> {
  req.user = 'anonymous';
  req.accessToken = env.edlToken;
  req.authorized = true;
  return next();
}
