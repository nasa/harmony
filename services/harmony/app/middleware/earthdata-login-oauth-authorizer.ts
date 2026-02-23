import axios from 'axios';
import { AuthorizationCode, Token, ModuleOptions } from 'simple-oauth2';
import { RequestHandler, NextFunction } from 'express';
import { cookieOptions, setCookiesForEdl } from '../util/cookies';
import { listToText } from '@harmony/util/string';
import { hasCookieSecret } from '../util/cookie-secret';
import { RequestValidationError, UnauthorizedError } from '../util/errors';
import HarmonyRequest from '../models/harmony-request';
import env from '../util/env';

if (process.env.USE_EDL_CLIENT_APP === 'true') {
  const vars = ['OAUTH_CLIENT_ID', 'OAUTH_UID', 'OAUTH_PASSWORD', 'OAUTH_REDIRECT_URI', 'OAUTH_HOST'];

  const missingVars = vars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(`Earthdata Login configuration error: When USE_EDL_CLIENT_APP is true you must set ${listToText(missingVars)} in the environment`);
  }
}

export const oauthOptions: ModuleOptions = {
  client: {
    id: process.env.OAUTH_CLIENT_ID,
    secret: process.env.OAUTH_PASSWORD,
  },
  auth: { tokenHost: process.env.OAUTH_HOST },
  options: {
    credentialsEncodingMode: 'loose',
  },
};

// Earthdata Login (OAuth2) tokens have the following structure:
// {
//    "access_token": <string>,
//    "token_type": "Bearer",
//    "expires_in": <integer (seconds)>,
//    "refresh_token": <string>,
//    "endpoint":"/api/users/<username>",
//    "expires_at": <string (ISO Date + Milliseconds)>
// }

/**
 * Handles an Earthdata Login callback by verifying its "code" URL parameter, setting auth
 * state if valid, and redirecting the client to either the redirect specified in cookies or
 * the server root
 *
 * @param oauth2 - A simpleOAuth2 client configured to interact with Earthdata Login
 * @param req - The client request
 * @param res - The client response
 * @param _next - The next function in the middleware chain
 */
async function handleCodeValidation(oauth2: AuthorizationCode, req, res, _next): Promise<void> {
  const { state } = req.signedCookies;

  if (state !== req.query.state) {
    throw new RequestValidationError();
  }

  const tokenConfig = {
    code: req.query.code,
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
  };

  const { token } = await oauth2.getToken(tokenConfig);
  res.cookie('token', token, cookieOptions);
  res.clearCookie('redirect', cookieOptions);
  res.redirect(307, req.signedCookies.redirect || '/');
}

/**
 * Handles a logout by deleting the token persisted on the client.  Note: Due to non-standard
 * implementation, this does not currently invalidate the underlying token with Earthdata Login
 *
 * @param oauth2 - A simpleOAuth2 client configured to interact with Earthdata Login
 * @param req - The client request
 * @param res - The client response
 * @param _next - The next function in the middleware chain
 */
async function handleLogout(oauth2: AuthorizationCode, req, res, _next): Promise<void> {
  const { redirect } = req.query;

  const { token } = req.signedCookies;
  if (token) {
    const oauthToken = oauth2.createToken(token);
    await oauthToken.revokeAll();
    res.clearCookie('token', cookieOptions);
  }
  res.redirect(307, redirect || '/');
}

/**
 * Handles a call that has no authorization data and is not a redirect or validation, persisting
 * the current URL on the client for future redirection and then redirecting to Earthdata Login
 *
 * @param oauth2 - A simpleOAuth2 client configured to interact with Earthdata Login
 * @param req - The client request
 * @param res - The client response
 * @param _next - The next function in the middleware chain
 */
function handleNeedsAuthorized(oauth2: AuthorizationCode, req, res, _next): void {
  const state = setCookiesForEdl(req, res, cookieOptions);

  const url = oauth2.authorizeURL({
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
    state,
  });

  res.redirect(303, url);
}

/**
 * Validates an EDL token to ensure that EDL hasn't revoked it before the expiration
 * @param token - The token to check
 * @throws AxiosError if the token is invalid
 */
async function validateUserToken(token: Token): Promise<void> {
  await axios.post(
    `${oauthOptions.auth.tokenHost}/oauth/tokens/user?token=${encodeURIComponent(token.access_token as string)}`,
    null,
    {
      auth: {
        username: env.oauthUid,
        password: oauthOptions.client.secret,
      },
    },
  );
}

/**
 * Handles a call that has already been authorized through Earthdata Login, refreshing the token
 * as necessary and calling the provided function with the authorized username
 *
 * @param oauth2 - A simpleOAuth2 client configured to interact with Earthdata Login
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 *
 * @returns The result of calling the adapter's redirect method
 */
async function handleAuthorized(oauth2: AuthorizationCode, req, res, next: NextFunction): Promise<void> {
  const { token } = req.signedCookies;
  const oauthToken = oauth2.createToken(token);
  req.accessToken = oauthToken.token.access_token;
  try {
    if (oauthToken.expired()) {
      const refreshed = await oauthToken.refresh();
      res.cookie('token', refreshed.token, cookieOptions);
      req.accessToken = refreshed.token.access_token;
    } else {
      await validateUserToken(oauthToken.token);
    }
    const user = (oauthToken.token.endpoint as string).split('/').pop();
    req.context.logger = req.context.logger.child({ user });
    req.user = user;
    next();
  } catch (e) {
    req.context.logger.error('Failed to refresh expired token, forcing login through EDL.');
    req.context.logger.error(e.stack);
    res.clearCookie('token', cookieOptions);
    handleNeedsAuthorized(oauth2, req, res, next);
  }
}

/**
 * Builds Express.js middleware for doing EDL auth.  Environment variables:
 *
 * OAUTH_CLIENT_ID: The application client ID from EDL
 * OAUTH_PASSWORD: The application (not user) password from EDL
 * OAUTH_REDIRECT_URI: The URI EDL will redirect to after auth
 * OAUTH_HOST: URL to the Earthdata Login server instance to use
 *
 * @param paths - Paths that require auth
 * @returns Express.js middleware for doing EDL
 */
export default function buildEdlAuthorizer(paths: Array<string | RegExp> = []): RequestHandler {
  return async function earthdataLoginAuthorizer(req: HarmonyRequest, res, next): Promise<void> {
    const oauth2 = new AuthorizationCode(oauthOptions);
    const { token } = req.signedCookies;
    const requiresAuth = paths.some((p) => req.path.match(p)) &&
      !req.authorized &&
      req.method.toUpperCase() != 'PUT' && // we don't support PUT requests with the redirect
      !(req.path.toLowerCase().startsWith('/service-deployments-state') && hasCookieSecret(req));
    let handler;

    try {
      if (!token && req.headers.cookie && req.headers.cookie.indexOf('token=') !== -1) {
        // Handle the case where a token comes in but it's not signed or not signed correctly
        res.clearCookie('token', cookieOptions);
        if (requiresAuth) throw new UnauthorizedError();
      }

      if (req.path === '/oauth2/redirect') {
        handler = handleCodeValidation;
      } else if (req.path === '/oauth2/logout') {
        handler = handleLogout;
      } else if (token) {
        handler = handleAuthorized;
      } else if (requiresAuth) {
        handler = handleNeedsAuthorized;
      } else {
        // No auth interaction and doesn't need auth
        next();
        return;
      }
      await handler(oauth2, req, res, next);
    } catch (e) {
      req.context.logger.error(e.stack);
      if (e.message.startsWith('Response Error')) { // URS Error
        res.clearCookie('token', cookieOptions);
        next(new UnauthorizedError());
        return;
      }
      next(e);
    }
  };
}
