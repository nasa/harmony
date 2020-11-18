import { Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getRequestRoot } from '../util/url';
import env from '../util/env';
import version from '../util/version';

/**
 * Express.js handler that returns the main Harmony landing page content.
 *
 * Includes minimal JSON with a list of all of the Harmony routes. Flush this out as an
 * OpenAPI document at some point.
 * @param req The request sent by the client
 * @param res The response to send to the client
 * @returns {void}
 */
export default async function landingPage(req: HarmonyRequest, res: Response): Promise<void> {
  const root = getRequestRoot(req);
  res.render('index', {
    root,
    edlUrl: env.oauthHost,
    version,
    feedbackUrl: env.feedbackUrl,
  });
}
