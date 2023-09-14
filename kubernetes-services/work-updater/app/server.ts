import express from 'express';
import env from './util/env';
import log from '../../../app/util/log';
import router from './routers/router';
import { Server } from 'http';
import Updater from './workers/updater';

/**
 * Start the application
 * @returns An object containing the running components
 */
export default function start(): Server {

  // start the updater
  const updater = new Updater();
  updater.start().catch((e) => {
    log.error('Updater start failed');
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
