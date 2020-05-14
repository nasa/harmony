import { before, after } from 'mocha';
import request, { Test } from 'supertest';
import { Application } from 'express';

/**
 * Performs an EOS service request on the given collection with the given params
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} version The EOSS version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} granule The CMR Granule ID to perform a service on
 * @param {object} query The query parameters to pass to the EOSS request
 * @returns {Promise<Response>} The response
 */
export function eossGetGranule(
  app: Application, version: string, collection: string, granule: string, query: object = {},
): Test {
  return request(app)
    .get(`/${collection}/eoss/${version}/items/${granule}`)
    .query(query);
}

/**
 * Adds before/after hooks to run an EOS service request
 *
 * @param {String} version The EOSS version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} granule The CMR Granule ID to perform a service on
 * @param {object} query The query parameters to pass to the EOSS request
 * @returns {void}
 */
export function hookEossGetGranule(
  version: string, collection: string, granule: string, query: object,
): void {
  before(async function () {
    this.res = await eossGetGranule(this.frontend, version, collection, granule, query);
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Makes a call to return the EOSS spec.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} version The specification version
 * @returns {Promise<Response>} The response
 */
export function eossSpecRequest(app: Application, version: string): Promise<any> {
  return request(app).get(`/docs/eoss/${version}/spec`);
}

/**
 * Makes a call to return the EOSS landing page.
 *
 * @param {any} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function eossLandingPageRequest(app: Application): Promise<any> {
  return request(app).get('/docs/eoss');
}
