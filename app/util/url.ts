const url = require('url');

/**
 * Returns the full string URL being accessed by a http.IncomingMessage, "req" object
 *
 * @param {http.IncomingMessage} req The incoming request whose URL should be gleaned
 * @returns {string} The URL the incoming request is requesting
 */
function getRequestUrl(req) {
  return url.format({
    protocol: req.protocol,
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0],
  });
}

module.exports = {
  getRequestUrl,
};
