import request from 'supertest';
import { hookRequest } from './hooks';

/**
 * Makes a /admin/health request
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function getAdminHealth(app): request.Test {
  return request(app).get('/admin/health');
}

/**
 * Makes a /health request
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function getHealth(app): request.Test {
  return request(app).get('/health');
}

export const hookGetAdminHealth = hookRequest.bind(this, getAdminHealth);
export const hookGetHealth = hookRequest.bind(this, getHealth);

