import { Router, json } from 'express';
import asyncHandler from 'express-async-handler';
import env from '../util/env';
import handleCallbackMessage from '../backends/deployment-callback';
import { getWork, updateWorkItem } from '../backends/workflow-orchestration/workflow-orchestration';
import { responseHandler } from '../backends/service-response';
import { getEligibleWorkItemCountForServiceID } from '../backends/service-metrics';
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
    limit: env.maxHarmonyBackEndJsonSize,
  }));
  result.post('/:requestId/response', asyncHandler(responseHandler));
  result.get('/work', asyncHandler(getWork));
  result.put('/work/:id', asyncHandler(updateWorkItem));

  result.get('/metrics', asyncHandler(getEligibleWorkItemCountForServiceID));

  result.post('/deployment-callback', asyncHandler(handleCallbackMessage));

  result.use((err, _req, _res, _next) => {
    if (err) {
      log.error(err);
      _next(err);
    } else {
      log.error('404');
      _next();
    }
  });
  return result;
}
