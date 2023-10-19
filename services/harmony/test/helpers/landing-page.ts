import request from 'supertest';
import { hookRequest } from './hooks';

/**
 * Makes a request to the landing page
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function landingPage(app: Express.Application): request.Test {
  return request(app).get('/');
}

export const hookLandingPage = hookRequest.bind(this, landingPage);
