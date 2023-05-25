import express, { NextFunction } from 'express';

/**
 * Set up routes for the service. These are used exclusively by Kubernetes.
 * @returns Router configured with service routes.
 */
export default function router(): express.Router {
  const result = express.Router();

  result.get('/liveness', async (req, res, _next: NextFunction): Promise<void> => {
    res.send('OK');
  });

  result.get('/readiness', async (req, res, _next: NextFunction): Promise<void> => {
    res.send('OK');
  });

  return result;
}
