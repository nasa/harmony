const url = require('url');

/**
 * Returns the protocol (http or https) depending on whether using localhost or not
 *
 * @param {http.IncomingMessage} req The incoming request whose URL should be gleaned
 * @returns {string} The protocol (http or https) to use for public Harmony URLs
 */
function _getProtocol(req) {
  const host = req.get('host');
  return (host === 'localhost' || host === '127.0.0.1') ? 'http' : 'https';
}

/**
 * Returns the full string URL being accessed by a http.IncomingMessage, "req" object
 *
 * @param {http.IncomingMessage} req The incoming request whose URL should be gleaned
 * @param {boolean} includeQuery Include the query string in the returned URL (default: true)
 * @returns {string} The URL the incoming request is requesting
 */
function getRequestUrl(req, includeQuery = true) {
  return url.format({
    protocol: _getProtocol(req),
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0],
    query: includeQuery ? req.query : null,
  });
}

/**
 * Returns the root of the request (protocol, host, port, with path = "/")
 *
 * @param {http.IncomingMessage} req The incoming request whose URL should be gleaned
 * @returns {string} The URL the incoming request is requesting
 */
function getRequestRoot(req) {
  return url.format({
    protocol: _getProtocol(req),
    host: req.get('host'),
  });
}

module.exports = {
  getRequestUrl,
  getRequestRoot,
};
