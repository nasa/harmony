import * as axios from 'axios';
import { RequestHandler } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { ForbiddenError } from '../util/errors';

const BEARER_TOKEN_REGEX = new RegExp('^Bearer ([-a-zA-Z0-9._~+/]+)$', 'i');
const edlUserRequestUrl = `${process.env.OAUTH_HOST}/oauth/tokens/user`;
const edlClientCredentialsUrl = `${process.env.OAUTH_HOST}/oauth/token`;
const clientCredentialsData = {
  params: { grant_type: 'client_credentials' },
  auth: {
    username: process.env.OAUTH_CLIENT_ID,
    password: process.env.OAUTH_PASSWORD,
  },
};

/**
 * Makes a request to the EDL users endpoint to validate a token and return the user ID
 * associated with that token.
 *
 * @param clientToken The harmony client token
 * @param userToken The user's token
 * @param logger The logger associated with the request
 * @returns the username associated with the token
 * @throws ForbiddenError if the token is invalid
 */
export async function getUserIdRequest(clientToken, userToken, logger): Promise<string> {
  try {
    const response = await axios.default.post(
      edlUserRequestUrl,
      null,
      {
        params: {
          client_id: process.env.OAUTH_CLIENT_ID,
          token: userToken,
        },
        headers: { authorization: `Bearer ${clientToken}` },
      },
    );
    return response.data.uid;
  } catch (e) {
    logger.error('Failed to validate passed in bearer token.');
    logger.error(e);
    throw new ForbiddenError();
  }
}

/**
 * Returns the bearer token to use in all EDL requests from Harmony
 * @param logger The logger associated with the request
 */
export async function getClientCredentialsToken(logger): Promise<string> {
  try {
    const response = await axios.default.post(edlClientCredentialsUrl, null, clientCredentialsData);
    return response.data.access_token;
  } catch (e) {
    logger.error('Failed to get client credentials for harmony user.');
    logger.error(e);
    throw new ForbiddenError();
  }
}

/**
 * Builds Express.js middleware for authenticating an EDL token and extracting the username.
 * Only used for routes that require authentication. If no token is passed in then the
 * middleware does nothing and forces the user through the oauth workflow.
 *
 * @param {Array<string>} paths Paths that require authentication
 * @returns {Function} Express.js middleware for doing EDL token authentication
 */
export default function buildEdlAuthorizer(paths: Array<string | RegExp> = []): RequestHandler {
  return async function edlTokenAuthorizer(req: HarmonyRequest, res, next): Promise<void> {
    const requiresAuth = paths.some((p) => req.path.match(p));
    if (!requiresAuth) return next();

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(BEARER_TOKEN_REGEX);
      if (match) {
        const { logger } = req.context;
        const userToken = match[1];
        // Generates a new client credentials token for each user request passing in a token
        // We should reuse client credentials if possible (seems like simple-oauth2 lib might)
        try {
          const clientToken = await exports.getClientCredentialsToken(logger);
          // Get the username for the provided token from EDL
          const username = await exports.getUserIdRequest(clientToken, userToken, logger);
          req.user = username;
          req.accessToken = userToken;
          req.authorized = true;
        } catch (e) {
          next(e);
        }
      }
    }
    return next();
  };
}
