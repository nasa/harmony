import HarmonyRequest from '../models/harmony-request';

/**
 * Validate that the request has correct cookie secret in header
 * @param req - The request object
 * @returns Boolean `true` if the request has correct cookie secret in header, `false` otherwise
 */
export function hasCookieSecret(req: HarmonyRequest): boolean {
  const headerSecret = req.headers['cookie-secret'];
  const secret = process.env.COOKIE_SECRET;
  if (headerSecret === secret) {
    return true;
  }

  return false;
}
