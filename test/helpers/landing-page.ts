import request from 'supertest';
import { hookRequest } from './hooks';

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function landingPage(app) {
  return request(app).get('/');
}

export const hookLandingPage = hookRequest.bind(this, landingPage);
