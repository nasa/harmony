import * as url from 'url';

/**
 * Returns the protocol (http or https) depending on whether using localhost or not
 *
 * @param req - The incoming request whose URL should be gleaned
 * @returns The protocol (http or https) to use for public Harmony URLs
 */
function _getProtocol(req): string {
  const host = req.get('host');
  return (host.startsWith('localhost')
    || host.startsWith('internal-harmony') // using an internal harmony load balancer
    || host.startsWith('127.0.0.1')) ? 'http' : 'https';
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
 * https://nodejs.org/api/url.html#urlresolvefrom-to
 * @param from 
 * @param to 
 * @returns 
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
