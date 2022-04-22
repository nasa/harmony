import request, { Test } from 'supertest';
import _ from 'lodash';
import { hookRequest } from './hooks';

/**
 * Makes an admin request to configure the log level for Harmony
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values) and (optional) username.
 * e.g. \{username: 'billy', query: \{...\}\}
 */
export function getRequestMetrics(
  app: Express.Application,
  options: { username?: string; query?: object },
): Test {
  const { query } = options;
  return request(app).get('/admin/request-metrics').query(query);
}

export const hookGetRequestMetrics = hookRequest.bind(this, getRequestMetrics);
