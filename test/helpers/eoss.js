const request = require('supertest');

/**
 * Performs an EOS service request on the given collection with the given params
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} granule The CMR Granule ID to perform a service on
 * @param {object} query The query parameters to pass to the EOSS request
 * @returns {Promise<Response>} The response
 */
function eossRequest(app, collection, granule, query) {
  return request(app)
    .get(`/${collection}/eoss/items/${granule}`)
    .query(query);
}

/**
 * Makes a call to return the EOSS spec.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function eossSpecRequest(app) {
  return request(app).get('/docs/eoss/spec');
}

/**
 * Makes a call to return the EOSS landing page.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function eossLandingPageRequest(app) {
  return request(app).get('/docs/eoss');
}

module.exports = {
  eossRequest,
  eossSpecRequest,
  eossLandingPageRequest,
};
