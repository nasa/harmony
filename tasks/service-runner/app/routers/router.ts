import express, { NextFunction } from 'express';
import { generateMetricsForPrometheus } from '../service/service-metrics';
import env from '../util/env';
import axios from 'axios';
import logger from '../../../../app/util/log';

/**
 *
 * @returns Router configured with service routes.
 */
export default function router(): express.Router {
  const result = express.Router();

  result.get('/liveness', async (req, res, _next: NextFunction): Promise<void> => {
    if (env.workerPort) {
      const healthResp = await axios.get(`http://localhost:${env.workerPort}/liveness`);
      res.status(healthResp.status);
      res.send(healthResp.data);
    } else {
      res.send('OK');
    }
  });

  result.get('/readiness', async (req, res, _next: NextFunction): Promise<void> => {
    if (env.workerPort) {
      const healthResp = await axios.get(`http://localhost:${env.workerPort}/readiness`);
      res.status(healthResp.status);
      res.send(healthResp.data);
    } else {
      res.send('OK');
    }
  });

  result.get('/metrics', generateMetricsForPrometheus);

  return result;
}
