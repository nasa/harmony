import express, { RequestHandler } from 'express';
import { NextFunction } from 'express';
import doWork from '../api/worker';
import sem from '../util/semaphore';

export default function router(): express.Router {
  const result = express.Router();

  result.post('/work', doWork);

  result.get('/liveness', async (req, res, next: NextFunction): Promise<void> => {
    res.send('OK');
  })

  result.get('/readiness', async (req, res, next: NextFunction): Promise<void> => {
    if (sem.available(1)) {
      res.send('OK');
    } else {
      res.status(502);
      res.send('Busy');
      // next(new Error('Busy'));
    }
  })

  return result;
}