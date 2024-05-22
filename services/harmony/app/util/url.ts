import * as url from 'url';

/**
 * Returns the protocol (http or https) depending on whether using localhost or not
 *
 * @param req - The incoming request whose URL should be gleaned
 * @returns The protocol (http or https) to use for public Harmony URLs
 */
function _getProtocol(req): string {
  if (process.env.USE_HTTPS === 'true') {
    return 'https';
  }
  const host = req.get('host');
  return (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https';
}

/**
 * Returns the full string URL being accessed by a http.IncomingMessage, "req" object
 *
 * @param req - The incoming request whose URL should be gleaned
 * @param includeQuery - Include the query string in the returned URL (default: true)
 * @param queryOverrides - Key/value pairs to set / override in the query
 * @returns The URL the incoming request is requesting
 */
export function getRequestUrl(req, includeQuery = true, queryOverrides: object = {}): string {
  return url.format({
    protocol: _getProtocol(req),
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0],
    query: includeQuery ? { ...req.query, ...queryOverrides } : null,
  });
}

/**
 * Returns the full string URL being accessed by a http.IncomingMessage, "req" object
 * after removing any trailing slashes from the path
 *
 * @param req - The incoming request whose URL should be gleaned
 * @param includeQuery - Include the query string in the returned URL (default: true)
 * @returns The URL the incoming request is requesting
 */
export function getSanitizedRequestUrl(req, includeQuery = true): string {
  return url.format({
    protocol: _getProtocol(req),
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0].replace(/\/+$/, ''),
    query: includeQuery ? req.query : null,
  });
}

/**
 * Returns the root of the request (protocol, host, port, with path = "/")
 *
 * @param req - The incoming request whose URL should be gleaned
 * @returns The URL the incoming request is requesting
 */
export function getRequestRoot(req): string {
  return url.format({
    protocol: _getProtocol(req),
    host: req.get('host'),
  });
}

/**
 * Resolves a target URL relative to a base URL in a manner similar to that of a web browser
 * resolving an anchor tag.
 * https://nodejs.org/api/url.html#urlresolvefrom-to
 * @param from - the base URL
 * @param to - the target URL
 * @returns the resolved URL
 */
export function resolve(from, to): string {
  const resolvedUrl = new URL(to, new URL(from, 'resolve://'));
  if (resolvedUrl.protocol === 'resolve:') {
    // `from` is a relative URL.
    const { pathname, search, hash } = resolvedUrl;
    return pathname + search + hash;
  }
  return resolvedUrl.toString();
}

/**
 * Checks if a string is a valid URI
 * @param str - the string to check
 * @returns true if the string is a valid URI and false otherwise
 */
export function isValidUri(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch (_) {
    return false;
  }
}