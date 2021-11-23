import request from 'supertest';
import { hookBackendRequest } from './hooks';

/**
 * Makes a request to the service/metrics endpoint
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function serviceMetrics(app: Express.Application): request.Test {
  return request(app).get('/service/metrics');
}

export const hookServiceMetrics = hookBackendRequest.bind(this, serviceMetrics);
