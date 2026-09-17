import { RequestHandler } from 'express';
import { LRUCache } from 'lru-cache';

import HarmonyRequest from '../models/harmony-request';
import { getUserIdRequest } from '../util/edl-api';
import env from '../util/env';

const BEARER_TOKEN_REGEX = new RegExp('^Bearer ([-a-zA-Z0-9._~+/]+)$', 'i');

/**
 * Wrapper function of getUserIdRequest to be set to fetchMethod of LRUCache.
 *
 * @param token - EDL bearer token
 * @param _sv - stale value parameter of LRUCache fetchMethod, unused here
 * @param options - options parameter of LRUCache fetchMethod, carries the request context
 * @returns Promise of user name associated with the EDL token
 */
async function fetchUserId(token: string, _sv: string, { context }): Promise<string> {
  return getUserIdRequest(context, token);
}

// In memory cache for EDL bearer token to username.
// A token is valid if it exists in the cache.
export const tokenCache = new LRUCache({
  ttl: env.tokenCacheTtl,
  maxSize: env.tokenCacheSize,
  sizeCalculation: (value: string): number => value.length,
  fetchMethod: fetchUserId,
});

/**
 * Builds Express.js middleware for authenticating an EDL token and extracting the username.
 * Used for routes that require authentication as well as routes for which authentication is
 * optional. If no token is passed in for a route that requires authentication then the
 * middleware does nothing, leaving it to `earthdataLoginOauthAuthorizer` to force the user
 * through the oauth workflow. For a route where authentication is merely optional, a bearer
 * token is honored if provided, but its absence never triggers the oauth workflow.
 *
 * @param paths - Paths that require authentication
 * @param optionalAuthPaths - Paths for which authentication is optional but a bearer token,
 * if provided, should still be honored
 * @returns Express.js middleware for doing EDL token authentication
 */
export default function buildEdlAuthorizer(
  paths: Array<string | RegExp> = [],
  optionalAuthPaths: Array<string | RegExp> = [],
): RequestHandler {
  return async function edlTokenAuthorizer(req: HarmonyRequest, res, next): Promise<void> {
    const isCorsPreflight = req.method.toUpperCase() === 'OPTIONS'; // should not use auth
    const requiresAuth = !isCorsPreflight && paths.some((p) => req.path.match(p));
    const allowsOptionalAuth = !isCorsPreflight && optionalAuthPaths.some((p) => req.path.match(p));

    if (!requiresAuth && !allowsOptionalAuth) return next();

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(BEARER_TOKEN_REGEX);
      if (match) {
        const userToken = match[1];
        try {
          // Get the username for the provided token from EDL
          const username = await tokenCache.fetch(userToken, { context: req.context });
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
