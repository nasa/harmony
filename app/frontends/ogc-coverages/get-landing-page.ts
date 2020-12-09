import { getRequestUrl } from 'util/url';

/**
 *  Returns the URL of the request with no trailing slash
 *
 * @param req - the incoming request
 * @returns The URL of the request with no trailing slash
 */
function requestRoot(req): string {
  const root = getRequestUrl(req, false);
  return root.replace(/\/$/, '');
}

/**
 * Express handler that responds to OGC API landing page requests
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default function getLandingPage(req, res): void {
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
