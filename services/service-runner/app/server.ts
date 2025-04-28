/* eslint-disable no-process-exit */
import express from 'express';
import { Server } from 'http';

import log from '../../harmony/app/util/log';
import router from './routers/router';
import env from './util/env';
import { waitForContainerToStart } from './util/k8s';
import PullWorker from './workers/pull-worker';

/**
 *
 * @param config - The configuration Record from the environment variables
 * @returns An object containing the running components
 */
export default async function start(_config: Record<string, string>): Promise<Server> {
  // trap SIGTERM so we can shut down gracefully via the PreStop hook
  process.on('SIGTERM', function () {
    process.exit(0);
  });

  // Wait for the worker container to be ready
  const workerRunning = await waitForContainerToStart('worker');

  if (!workerRunning) {
    throw new Error('Worker container did not start up successfully');
  }

  // start the puller
  const pullWorker = new PullWorker();
  pullWorker.start().catch((e) => {
    log.error('Work puller start failed');
    throw e;
  });

  const app = express();

  app.use(express.json());
  app.use('/', router());

  return app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
}

if (require.main === module) {
  void (async (): Promise<void> => {
    try {
      await start(process.env);
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  })();
}