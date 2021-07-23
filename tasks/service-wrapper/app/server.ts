import express from 'express';
import env from './util/env';
import log from './util/log';
import router from './routers/router';
import PullWorker from './workers/pull-worker';

/**
 *
 * @param config - The configuration Record from the environment variables
 * @returns An object containing the running components
 */
export default function start(_config: Record<string, string>): {} {
  // start the puller
  const pullWorker = new PullWorker();
  pullWorker.start();

  const app = express();

  app.use(express.json());
  app.use('/', router());

  return app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
}

if (require.main === module) {
  start(process.env);
}
