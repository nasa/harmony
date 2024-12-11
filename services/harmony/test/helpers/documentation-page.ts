import request from 'supertest';
import { hookRequest } from './hooks';

/**
 * Makes a request to the documentation page
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function documentationPage(app): request.Test {
  return request(app).get('/docs');
}

export const hookDocumentationPage = hookRequest.bind(this, documentationPage);
