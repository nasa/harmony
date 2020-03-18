const { getRequestUrl } = require('../../util/url');

/**
 * Express.js-style handler that responds to OGC API - Coverages describe
 * collections requests.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 * @throws {RequestValidationError} Thrown if the request has validation problems and
 *   cannot be performed
 */
function describeCollections(req, res) {
  const variables = [];
  for (const collection of req.collections) {
    const requestRoot = getRequestUrl(req, false);
    const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
    const collectionLongLabel = `${collectionShortLabel} (${collection.archive_center || collection.data_center})`;
    for (const variable of collection.variables) {
      variables.push({
        id: `${collection.id}/${variable.concept_id}`,
        title: `${variable.name} ${collectionShortLabel}`,
        description: `${variable.long_name} ${collectionLongLabel}`,
        links: [{
          title: `Perform rangeset request for ${variable.name}`,
          href: `${requestRoot}/${variable.name}/coverage/rangeset`,
        }],
        extent: {
          spatial: {
            bbox: collection.boxes,
            crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
          },
          temporal: {
            interval: [collection.time_start, collection.time_end],
            trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
          },
        },
        itemType: 'Variable',
        crs: 'TODO get from UMM-S or services.yml capabilities.output_projections',
      });
    }
  }
  res.send({
    links: [],
    collections: variables,
  });
}

module.exports = describeCollections;
