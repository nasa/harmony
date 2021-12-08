import { Response, Request, NextFunction } from 'express';
import axios from 'axios';
import Agent from 'agentkeepalive';
import env from '../util/env';

export const exportedForTesting = {
  _getHarmonyMetric,
};

/**
 * Get prometheus-compatible metric message from harmony backend
 * @param serviceID - The service name (essentially the image name)
 * @returns Promise of prometheus-compatible metric message
 */
 async function _getHarmonyMetric(serviceID: string): Promise<string> {

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

  const workUrl = `http://${env.backendHost}:${env.backendPort}/service/metrics`;
  const response = await axios
      .get(workUrl, {
          params: { serviceID },
          timeout,
          responseType: 'json',
          httpAgent: keepaliveAgent,
          validateStatus(status) {
              return status === 200;
          },
      });

  const metric_message = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${serviceID}"} ${response.data.availableWorkItems}`;

  return metric_message;
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

  // Get harmony metric for the present service
  const serviceID = env.harmonyService;
  const metric_message = await _getHarmonyMetric(serviceID);

  // Send response
  res.send(metric_message);
}