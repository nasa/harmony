const simpleOAuth2 = require('simple-oauth2');
const urlUtil = require('../util/url');
const { ForbiddenError, ServerError } = require('../util/errors');

const vars = ['OAUTH_CLIENT_ID', 'OAUTH_PASSWORD', 'OAUTH_REDIRECT_URI', 'OAUTH_HOST'];

for (const variable of vars) {
  if (!process.env[variable]) {
    throw new Error(`Earthdata Login configuration error: You must set the ${variable} environment variable`);
  }
}

const cookieOptions = { signed: true, secure: process.env.USE_HTTPS === 'true' };
const oauthOptions = {
  client: {
    id: process.env.OAUTH_CLIENT_ID,
    secret: process.env.OAUTH_PASSWORD,
  },
  auth: { tokenHost: process.env.OAUTH_HOST },
};

/**
 * Handles an Earthdata Login callback by verifying its "code" URL parameter, setting auth
 * state if valid, and redirecting the client to either the redirect specified in cookies or
 * the server root
 *
 * @param {Object} oauth2 A simpleOAuth2 client configured to interact with Earthdata Login
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} _next The next function in the middleware chain
 * @returns {void}
 */
async function handleCodeValidation(oauth2, req, res, _next) {
  const tokenConfig = {
    code: req.query.code,
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
  };

  const oauthToken = await oauth2.authorizationCode.getToken(tokenConfig);
  const tokenStr = JSON.stringify(oauth2.accessToken.create(oauthToken).token);
  res.cookie('token', tokenStr, cookieOptions);
  res.redirect(307, req.signedCookies.redirect || '/');
}

/**
 * Handles a logout by deleting the token persisted on the client.  Note: Due to non-standard
 * implementation, this does not currently invalidate the underlying token with Earthdata Login
 *
 * @param {Object} oauth2 A simpleOAuth2 client configured to interact with Earthdata Login
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} _next The next function in the middleware chain
 * @returns {void}
 */
function handleLogout(oauth2, req, res, _next) {
  const { redirect } = req.query;

  const { token } = req.signedCookies;
  if (token) {
    // Revocation does not currently work due to non-standard OAuth Impl.
    // Bug: https://bugs.earthdata.nasa.gov/browse/URSFOUR-1042
    //
    // If we need to revoke in the mean time, we can
    // DELETE /oauth2/token/{token}
    //
    // See https://developer.earthdata.nasa.gov/urs/urs-integration/working-with-the-earthdata-login-api/api-documentation
    //
    // const oauthToken = oauth2.accessToken.create(token);
    // oauthToken.revokeAll();

    res.clearCookie('token', cookieOptions);
  }

  res.redirect(307, redirect || '/');
}

/**
 * Handles a call that has already been authorized through Earthdata Login, refreshing the token
 * as necessary and calling the provided function with the authorized username
 *
 * @param {Object} oauth2 A simpleOAuth2 client configured to interact with Earthdata Login
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 *
 * @returns {*} The result of calling the adapter's redirect method
 */
async function handleAuthorized(oauth2, req, res, next) {
  const token = JSON.parse(req.signedCookies.token);
  const oauthToken = oauth2.accessToken.create(token);
  if (oauthToken.expired()) {
    const refreshed = await oauthToken.refresh();
    const tokenStr = JSON.stringify(refreshed.token);
    res.cookies('token', tokenStr, cookieOptions);
  }

  req.user = oauthToken.token.endpoint.split('/').pop();
  next();
}

/**
 * Handles a call that has no authorization data and is not a redirect or validation, persisting
 * the current URL on the client for future redirection and then redirecting to Earthdata Login
 *
 * @param {Object} oauth2 A simpleOAuth2 client configured to interact with Earthdata Login
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} _next The next function in the middleware chain
 * @returns {void}
 */
function handleNeedsAuthorized(oauth2, req, res, _next) {
  const url = oauth2.authorizationCode.authorizeURL({
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
  });

  res.cookie('redirect', urlUtil.getRequestUrl(req), cookieOptions);
  res.redirect(307, url);
}

/**
 * Express.js middleware for doing EDL auth.  Environment variables:
 *
 * OAUTH_CLIENT_ID: The application client ID from EDL
 * OAUTH_PASSWORD: The application (not user) password from EDL
 * OAUTH_REDIRECT_URI: The URI EDL will redirect to after auth
 * OAUTH_HOST: URL to the Earthdata Login server instance to use
 *
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 */
module.exports = async function earthdataLoginAuthorizer(req, res, next) {
  const oauth2 = simpleOAuth2.create(oauthOptions);
  const { token } = req.signedCookies;
  let handler;

  try {
    if (req.path === '/oauth2/redirect') {
      handler = handleCodeValidation;
    } else if (req.path === '/oauth2/logout') {
      handler = handleLogout;
    } else if (token) {
      handler = handleAuthorized;
    } else {
      handler = handleNeedsAuthorized;
    }
    await handler(oauth2, req, res, next);
  } catch (e) {
    if (e.message.startsWith('Response Error')) { // URS Error
      res.clearCookie('token', cookieOptions);
      throw new ForbiddenError();
    }
    req.logger.error(e.stack);
    next(e);
  }
};
