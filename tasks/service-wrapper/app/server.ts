import express, { Response, NextFunction, RequestHandler } from 'express';
import { port } from './util/env'
import log from './util/log';
import router from './routers/router';


export function start(config: Record<string, string>): {} {
  const app = express();

  app.use(express.json());
  app.use('/', router());

  return app.listen(port, '0.0.0.0', () => {
    log.info(`Application listening on port ${port}`);
  });
}

if (require.main === module) {
  start(process.env);
}