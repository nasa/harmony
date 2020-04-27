/**
 * Express handler that responds to OGC API conformance requests, returning
 * the list of specifications this API conforms to.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 */
function getRequirementsClasses(req, res) {
  res.json({
    conformsTo: [
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/collections',
      'http://www.opengis.net/spec/ogcapi-coverages-1/1.0/conf/core',
    ],
  });
}

module.exports = getRequirementsClasses;
