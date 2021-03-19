import { Router, urlencoded, json } from 'express';
import { responseHandler } from '../backends/service-response';
import argoResponsehandler from '../backends/argo-response';
import log from '../util/log';

/**
 * Creates and returns an Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns A router which can respond to backend services
 */
export default function router(): Router {
  const result = Router();
  result.use(json({
    type: 'application/json',
  }));
  result.post('/:requestId/response', responseHandler);
  // result.use(urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
  result.post('/:requestId/argo-response', argoResponsehandler);
  result.use((err, _req, _res, _next) => {
    if (err) {
      log.error(err);
    } else {
      log.error('404');
    }
  });
  return result;
}
