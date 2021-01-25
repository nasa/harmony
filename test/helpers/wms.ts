import { before, after } from 'mocha';
import request, { Test } from 'supertest';

/**
 * Example of a collection that can be hooked up to WMS
 */
export const validCollection = 'C1234088182-EEDTEST';

/**
 * Example of a valid WMS query for use in tests.
 */
export const validGetMapQuery = {
  service: 'WMS',
  request: 'GetMap',
  layers: validCollection,
  crs: 'EPSG:4326',
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
 * @param app - The express application (typically this.frontend)
 * @param collection - The collection on which the request should be performed
 * @param query - The query parameters to pass to the WMS request
 * @returns The response
 */
export function wmsRequest(
  app: Express.Application, collection: string = validCollection, query: object = validGetMapQuery,
): Test {
  return request(app)
    .get(`/${collection}/wms`)
    .query(query);
}

/**
 * Adds before/after hooks to run a GetCapabilities request on the given collection
 *
 * @param collection - The CMR Collection ID to query
 */
export function hookGetCapabilities(collection: string): void {
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
 * @param collection - The CMR Collection ID to query
 * @param query - Query parameters other than "service" and "request" to send
 */
export function hookGetMap(
  collection: string = validCollection, query: object = validGetMapQuery,
): void {
  before(async function () {
    this.res = await wmsRequest(this.frontend, collection, { service: 'WMS', request: 'GetMap', ...query });
  });
  after(function () {
    delete this.res;
  });
}
