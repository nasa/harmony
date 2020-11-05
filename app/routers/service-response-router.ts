import { Router, urlencoded } from 'express';
import { responseHandler } from '../backends/service-response';
import argoResponsehandler from '../backends/argo-response';

/**
 * Creates and returns an Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns {Router} A router which can respond to backend services
 */
export default function router(): Router {
  const result = Router();
  result.post('/:requestId/response', responseHandler);
  result.use(urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
  result.post('/:requestId/argo-response', argoResponsehandler);
  return result;
}
