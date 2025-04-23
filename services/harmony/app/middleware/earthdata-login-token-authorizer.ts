import { RequestHandler } from 'express';

import HarmonyRequest from '../models/harmony-request';
import RequestContext from '../models/request-context';
import { getUserIdRequest } from '../util/edl-api';

const BEARER_TOKEN_REGEX = new RegExp('^Bearer ([-a-zA-Z0-9._~+/]+)$', 'i');

/**
 * Builds Express.js middleware for authenticating an EDL token and extracting the username.
 * Only used for routes that require authentication. If no token is passed in then the
 * middleware does nothing and forces the user through the oauth workflow.
 *
 * @param paths - Paths that require authentication
 * @returns Express.js middleware for doing EDL token authentication
 */
function makeCachedGetUserIdRequest(ttlMs: number) {
  const cache = new Map<string, { promise: Promise<string>; expires: number }>();

  return async (context: RequestContext, token: string): Promise<string> => {
    const now = Date.now();
    const cached = cache.get(token);

    if (cached && cached.expires > now) {
      return cached.promise;
    }

    const promise = getUserIdRequest(context, token).catch((err) => {
      cache.delete(token);
      throw err;
    });

    cache.set(token, { promise, expires: now + ttlMs });
    return promise;
  };
}

export const cachedGetUserIdRequest = makeCachedGetUserIdRequest(5 * 60 * 1000); // 5 min TTL

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
          const username = await cachedGetUserIdRequest(req.context, userToken);
          req.user = username;
          req.accessToken = userToken;
          req.authorized = true;
        } catch (e) {
          return next(e); // don't forget return here!
        }
      }
    }
    return next();
  };
}
