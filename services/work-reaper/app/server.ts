import express from 'express';
import env from './util/env';
import log  from '@harmony/harmony/app/util/log';
import router from './routers/router';
import { Server } from 'http';
import Reaper from './workers/reaper';

/**
 * Start the application
 * @returns An object containing the running components
 */
function start(): Server {
  // start the reaper
  const reaper = new Reaper();
  reaper.start().catch((e) => {
    log.error('reaper start failed');
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
  start();
}
