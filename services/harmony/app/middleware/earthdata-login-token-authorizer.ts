import { RequestHandler } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { getUserIdRequest } from '../util/edl-api';
import { MemoryCache } from '../util/cache/memory-cache';

const BEARER_TOKEN_REGEX = new RegExp('^Bearer ([-a-zA-Z0-9._~+/]+)$', 'i');

// In memory cache with 5 min TTL for EDL token to username.
// The token is valid if it exists in the cache.
export const tokenCache = new MemoryCache(getUserIdRequest, { ttl: 5 * 60 * 1000 });

/**
 * Builds Express.js middleware for authenticating an EDL token and extracting the username.
 * Only used for routes that require authentication. If no token is passed in then the
 * middleware does nothing and forces the user through the oauth workflow.
 *
 * @param paths - Paths that require authentication
 * @returns Express.js middleware for doing EDL token authentication
 */
export default function buildEdlAuthorizer(paths: Array<string | RegExp> = []): RequestHandler {
  return async function edlTokenAuthorizer(req: HarmonyRequest, res, next): Promise<void> {
    const requiresAuth = paths.some((p) => req.path.match(p));
    if (!requiresAuth) return next();

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(BEARER_TOKEN_REGEX);
      if (match) {
        const userToken = match[1];
        try {
          // Use the cached version
          const username = await tokenCache.fetch(userToken, req.context);
          req.user = username;
          req.accessToken = userToken;
          req.authorized = true;
        } catch (e) {
          return next(e);
        }
      }
    }
    return next();
  };
}
