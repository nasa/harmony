const { getRequestUrl } = require('../../util/url');

/**
 *  Returns the URL of the request with no trailing slash
 *
 * @param {http.Request} req the incoming request
 * @returns {string} The URL of the request with no trailing slash
 */
function requestRoot(req) {
  const root = getRequestUrl(req, false);
  return root.replace(/\/$/, '');
}

/**
 * Express handler that responds to OGC API landing page requests
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 */
function getLandingPage(req, res) {
  const root = requestRoot(req);
  res.json({
    links: [
      {
        href: `${root}/`,
        rel: 'self',
        type: 'application/json',
        title: 'this document',
      },
      {
        href: `${root}/api`,
        rel: 'service-desc',
        type: 'text/openapi+yaml;version=3.0',
        title: 'the API definition',
      },
      {
        href: `${root}/conformance`,
        rel: 'conformance',
        type: 'application/json',
        title: 'OGC conformance classes implemented by this API',
      },
      {
        href: `${root}/collections`,
        rel: 'data',
        type: 'application/json',
        title: 'Metadata about the resource collections',
      },
    ],
  });
}

module.exports = getLandingPage;
