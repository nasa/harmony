import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import env from './util/env';
import { buildErrorResponse, HttpError } from '../../../app/util/errors';
import log from '../../../app/util/log';
import router from './routers/router';

/**
 * Express.js middleware catching errors that escape service protocol handling and sending them
 * to users
 *
 * @param err - The error that occurred
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
function errorHandler(
  err: HttpError, req: Request, res: Response, next: NextFunction,
): void {
  if (res.headersSent) {
    // If the server has started writing the response, delegate to the
    // default error handler, which closes the connection and fails the
    // request
    next(err);
    return;
  }
  const statusCode = err.code || 500;
  const resp = buildErrorResponse(err);

  res.status(statusCode).json(resp);
}

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
  app.use(errorHandler);

  return app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
}

if (require.main === module) {
  start(process.env);
}
