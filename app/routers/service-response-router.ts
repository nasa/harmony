import { Request, Response, Router, json } from 'express';
import { responseHandler } from '../backends/service-response';
import argoResponsehandler from '../backends/argo-response';
import log from '../util/log';

/**
 * Return a work item for the given service
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
async function getWork(req: Request, res: Response): Promise<void> {
  // just hard-code the work here for development testing
  // TODO - get work for real from dB
  const { serviceId } = req.query;
  log.info(`Getting work for service [${serviceId}]`);
  setTimeout(() => {
    res.send({ work: 'got work' });
  }, 5_000);
}

/**
 * Update a work item from a service response
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
async function updateWorkItem(req: Request, res: Response): Promise<void> {
  // TODO - do something useful
  const { id } = req.params;
  log.info(`Updating work item ${id}`);
  res.send('OK');
}

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
