const { getRequestUrl, getRequestRoot } = require('../../util/url');

const WGS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
const gregorian = 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian';

/**
 * Creates the extent object returned in the collection listing
 * @param {Object} collection the collection info as returned by the CMR
 * @returns {Object} the extent object
 */
function generateExtent(collection) {
  let bbox;
  if (collection.boxes) {
    bbox = collection.boxes[0].split(' ').map((v) => parseFloat(v));
  }
  const spatial = bbox ? { bbox, crs: WGS84 } : undefined;

  let temporal;
  if (collection.time_start || collection.time_end) {
    temporal = { interval: [collection.time_start, collection.time_end], trs: gregorian };
  }

  const extent = (spatial || temporal) ? { spatial, temporal } : undefined;
  return extent;
}

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
  const links = [];
  const variables = [];
  for (const collection of req.collections) {
    const requestUrl = getRequestUrl(req, false);
    const ogcApiRoot = requestUrl.replace(/\/collections$/, '');
    const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
    const collectionLongLabel = `${collectionShortLabel} (${collection.archive_center || collection.data_center})`;
    const rootLink = {
      title: `OGC coverages API root for ${collectionShortLabel}`,
      href: ogcApiRoot,
    };
    const selfLink = {
      title: `Collections listing for ${collectionShortLabel}`,
      href: requestUrl,
    };
    links.push(rootLink, selfLink);
    const extent = generateExtent(collection);

    for (const variable of collection.variables) {
      variables.push({
        id: `${collection.id}/${variable.concept_id}`,
        title: `${variable.name} ${collectionShortLabel}`,
        description: `${variable.long_name} ${collectionLongLabel}`,
        links: [{
          title: `Perform rangeset request for ${variable.name}`,
          href: `${requestUrl}/${variable.name}/coverage/rangeset`,
        }],
        extent,
        itemType: 'Variable',
        // TODO set CRS
        // crs: 'TODO get from UMM-S or services.yml capabilities.output_projections',
      });
    }
  }
  res.send({
    links,
    collections: variables,
  });
}

module.exports = {
  describeCollections,
  generateExtent,
};
