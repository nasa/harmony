import request, { Test } from 'supertest';
import { hookRequest } from './hooks';

/**
 * Submits a request to the collection capabilities endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param query - The query which might contain keys collectionId or shortName
 */
export function getCollectionCapabilities(app, query = {}): Test {
  return request(app).get('/capabilities').query(query);
}

export const hookGetCollectionCapabilities = hookRequest.bind(this, getCollectionCapabilities);
