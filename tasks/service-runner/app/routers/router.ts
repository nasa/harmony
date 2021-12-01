import express, { NextFunction } from 'express';

/**
 *
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

  let gauge = 0;
  result.get('/metrics', (function (req, res) {
    gauge += 1;
    const prom_metric = 
   `# HELP custom_metric An example of a custom metric, using the gauge type.
    # TYPE custom_metric gauge
    custom_metric{service_id="harmony-service-example-latest"} ${gauge}`;
    return res.send(prom_metric);
  }));

  return result;
}
