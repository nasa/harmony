import { Router, json } from 'express';
import { getWork, updateWorkItem } from '../backends/workflow-orchestration';
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
  result.post('/:requestId/argo-response', argoResponsehandler);
  result.get('/work', getWork);
  result.put('/work/:id', updateWorkItem);

  result.use((err, _req, _res, _next) => {
    if (err) {
      log.error(err);
    } else {
      log.error('404');
    }
  });
  return result;
}
