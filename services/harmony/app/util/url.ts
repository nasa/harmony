import * as url from 'url';

/**
 * Returns the first value from a forwarded header.
 *
 * @param req - The incoming request
 * @param headerName - The header name to read
 * @returns The first forwarded value if present
 */
function getForwardedValue(req, headerName: string): string | undefined {
  const header = req.get(headerName);
  if (!header) return undefined;
  return header.split(',')[0].trim();
}

/**
 * Returns a normalized forwarded protocol when valid.
 *
 * @param req - The incoming request
 * @returns `http` or `https` when present and valid
 */
function getForwardedProto(req): string | undefined {
  const proto = getForwardedValue(req, 'x-forwarded-proto')?.toLowerCase();
  if (proto === 'http' || proto === 'https') return proto;
  return undefined;
}

/**
 * Returns a forwarded port when valid.
 *
 * @param req - The incoming request
 * @returns A numeric port string when present and valid
 */
function getForwardedPort(req): string | undefined {
  const port = getForwardedValue(req, 'x-forwarded-port');
  if (port && /^\d+$/.test(port)) return port;
  return undefined;
}

/**
 * Returns the best host value for externally visible URLs.
 *
 * @param req - The incoming request
 * @returns Host with port when available
 */
function getHost(req): string {
  const directHost = req.get('host');
  const forwardedHost = getForwardedValue(req, 'x-forwarded-host');
  const forwardedPort = getForwardedPort(req);
  const shouldPreferDirectHost = !forwardedPort && directHost?.includes(':') && forwardedHost && !forwardedHost.includes(':');
  const host = shouldPreferDirectHost ? directHost : (forwardedHost || directHost);

  if (!host) return '';

  if (!forwardedPort || host.includes(':')) return host;

  return `${host}:${forwardedPort}`;
}

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
  const forwardedProto = getForwardedProto(req);
  if (forwardedProto) {
    return forwardedProto;
  }
  // Check if the connection is actually secure (HTTPS)
  // req.secure is set when the connection is TLS/SSL
  // req.protocol is the protocol scheme (http, https, ws, wss) used by the connection
  if (req.secure || req.protocol === 'https') {
    return 'https';
  }
  const host = getHost(req);
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
    host: getHost(req),
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
    host: getHost(req),
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
    host: getHost(req),
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
