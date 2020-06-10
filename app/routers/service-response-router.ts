import { Router } from 'express';
import { responseHandler } from '../backends/service-response';

/**
 * Creates and returns an Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns {Router} A router which can respond to backend services
 */
export default function router(): Router {
  const result = Router();
  result.post('/:requestId/response', responseHandler);
  return result;
}
