const { before, after } = require('mocha');
const request = require('supertest');

/**
 * Performs a WMS request on the given collection with the given params
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The collection on which the request should be performed
 * @param {object} query The query parameters to pass to the WMS request
 * @returns {Promise<Response>} The response
 */
function wmsRequest(app, collection, query) {
  return request(app)
    .get(`/${collection}/wms`)
    .query(query);
}

/**
 * Adds before/after hooks to run a GetCapabilities request on the given collection
 *
 * @param {string} collection The CMR Collection ID to query
 * @returns {void}
 */
function hookGetCapabilities(collection) {
  before(async function () {
    this.res = await wmsRequest(this.frontend, collection, { service: 'WMS', request: 'GetCapabilities' });
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Adds before/after hooks to run a GetMap request on the given collection
 *
 * @param {string} collection The CMR Collection ID to query
 * @param {object} query Query parameters other than "service" and "request" to send
 * @returns {void}
 */
function hookGetMap(collection, query) {
  before(async function () {
    this.res = await wmsRequest(this.frontend, collection, { service: 'WMS', request: 'GetMap', ...query });
  });
  after(function () {
    delete this.res;
  });
}

module.exports = {
  hookGetCapabilities,
  hookGetMap,
  wmsRequest,
};
