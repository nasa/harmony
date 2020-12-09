/**
 * Express handler that responds to OGC API conformance requests, returning
 * the list of specifications this API conforms to.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default function getRequirementsClasses(req, res): void {
  res.json({
    conformsTo: [
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/collections',
      'http://www.opengis.net/spec/ogcapi-coverages-1/1.0/conf/core',
    ],
  });
}
