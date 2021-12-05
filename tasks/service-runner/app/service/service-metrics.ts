import { Response, Request, NextFunction } from 'express';
import axios from 'axios';
import Agent from 'agentkeepalive';
import env from '../util/env';
import { sanitizeImage } from '../../../../app/util/string';
import logger from '../../../../app/util/log';

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

  const workUrl = `http://${env.backendHost}:${env.backendPort}/service/metrics`;
  const serviceName = sanitizeImage(env.harmonyService);

  logger.info(`generates the Prometheus compatible metrics for ${serviceName}`);

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

  try {
    const response = await axios
        .get(workUrl, {
            params: { serviceID: serviceName }, //'harmonyservices/netcdf-to-zarr:latest' },
            timeout,
            responseType: 'json',
            httpAgent: keepaliveAgent,
            validateStatus(status) {
                return [200, 400, 404].includes(status);
            },
        });
    logger.info(`New QUERY: ${workUrl} now`)
    logger.info(`GOT: ${response.status} ,${response.data}`);

    let gauge = 0;
    gauge += 1;
    const prom_metric = 
    `# HELP custom_metric An example of a custom metric, using the gauge type.
    # TYPE custom_metric gauge
    custom_metric{service_id="query-cmr-latest"} ${gauge}`;
    res.send(prom_metric);

  } catch (e) {
        next(e);
  }
}
