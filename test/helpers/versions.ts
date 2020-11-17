import request from 'supertest';
import { hookRequest } from './hooks';

/**
 * Makes a request to the versions endpoint
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function versions(app: Express.Application): request.Test {
  return request(app).get('/versions');
}

export const hookVersions = hookRequest.bind(this, versions);
