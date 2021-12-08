import { Response, Request, NextFunction } from 'express';
import axios from 'axios';
import Agent from 'agentkeepalive';
import env from '../util/env';
import { sanitizeImage } from '../../../../app/util/string';
import logger from '../../../../app/util/log';

export const exportedForTesting = {
  _getHarmonyMetric,
};

/**
 * Call a service to perform some work
 *
 * @param workItem - the work to be done
 */
 async function _getHarmonyMetric(): Promise<string> {

  const workUrl = `http://${env.backendHost}:${env.backendPort}/service/metrics`;
  const serviceName = sanitizeImage(env.harmonyService);

  const timeout = 3_000; // Wait up to 3 seconds for the server to start sending
  const activeSocketKeepAlive = 6_000;
  const maxSockets = 1;
  const maxFreeSockets = 1;
  const keepaliveAgent = new Agent({
    keepAlive: true,
    maxSockets,
    maxFreeSockets,
    timeout: activeSocketKeepAlive, // active socket keepalive for 60 seconds
    freeSocketTimeout: timeout, // free socket keepalive for 30 seconds
  });

  const response = await axios
      .get(workUrl, {
          params: { serviceID: serviceName },
          timeout,
          responseType: 'json',
          httpAgent: keepaliveAgent,
          validateStatus(status) {
              return status === 200;
          },
      });

  const harmony_metric = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${serviceName}"} ${response.data.availableWorkItems}`;

  return harmony_metric;
}

/**
 * Express.js handler that generates the Prometheus compatible metrics for the associated service
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function generateMetricsForPrometheus(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {

  const harmony_metric = _getHarmonyMetric(); 
  res.send(harmony_metric);
}