import express from 'express';
import env from './util/env';
import log from '../../../app/util/log';
import router from './routers/router';
import { Server } from 'http';

/**
 *
 * @param config - The configuration Record from the environment variables
 * @returns An object containing the running components
 */
export default function start(_config: Record<string, string>): Server {
  // trap SIGTERM so we can shut down gracefully via the PreStop hook
  process.on('SIGTERM', function () {
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

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
