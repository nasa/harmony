const { before, after } = require('mocha');
const request = require('supertest');

/**
 * Example of a collection that can be hooked up to WMS
 */
const validCollection = 'C1233800302-EEDTEST';

/**
 * Example of a valid WMS query for use in tests.
 */
const validGetMapQuery = {
  service: 'WMS',
  request: 'GetMap',
  layers: validCollection,
  crs: 'CRS:84',
  format: 'image/tiff',
  styles: '',
  width: 128,
  height: 128,
  version: '1.3.0',
  bbox: '-180,-90,180,90',
  transparent: 'TRUE',
};

/**
 * Performs a WMS request on the given collection with the given params.  By default
 * it will perform a GetMap request against a collection configured to accept GetMap.
 * Note this will perform an actual service call unless stubbed.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The collection on which the request should be performed
 * @param {object} query The query parameters to pass to the WMS request
 * @returns {Promise<Response>} The response
 */
function wmsRequest(app, collection = validCollection, query = validGetMapQuery) {
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
 * Adds before/after hooks to run a GetMap request on the given collection. If no
 * args are provided, it will run a basic default query against a collection that
 * is configured for WMS.  You should almost always run StubService.hook before
 * this to avoid invoking an actual service call.
 *
 * @param {string} collection The CMR Collection ID to query
 * @param {object} query Query parameters other than "service" and "request" to send
 * @returns {void}
 */
function hookGetMap(collection = validCollection, query = validGetMapQuery) {
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
  validGetMapQuery,
  validCollection,
};
