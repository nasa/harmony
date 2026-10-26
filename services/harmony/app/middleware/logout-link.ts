import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';

/**
 * Middleware that sets a `showLogoutLink` flag on `res.locals` so that every rendered HTML
 * page can include a link to log out. The link is only shown when the request carries a valid
 * Earthdata Login session cookie, since that is the session `/oauth2/logout` ends. Requests
 * authenticated with a bearer token have no session to end, so they do not get the link.
 *
 * Must be installed after the Earthdata Login OAuth authorizer, which rejects or clears
 * session cookies that are invalid or expired.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default function logoutLink(
  req: HarmonyRequest, res: Response, next: NextFunction,
): void {
  res.locals.showLogoutLink = !!req.signedCookies?.token;
  next();
}
