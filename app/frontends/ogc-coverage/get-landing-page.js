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

module.exports = function getLandingPage(req, res) {
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
        href: `${root}/ogc-api-coverages-1.0.0.yml`,
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
        rel: 'collections',
        type: 'application/json',
        title: 'Metadata about the resource collections',
      },
    ],
  });
};