import mustache from 'mustache';
import fs from 'fs';
import path from 'path';
import { Response, NextFunction } from 'express';
import {
  HttpError, RequestValidationError, buildJsonErrorResponse, getHttpStatusCode,
  getEndUserErrorMessage, getCodeForError,
} from '../util/errors';
import HarmonyRequest from '../models/harmony-request';

const errorTemplate = fs.readFileSync(path.join(__dirname, '../views/server-error.mustache.html'), { encoding: 'utf8' });
const jsonErrorRoutesRegex = /jobs|capabilities|ogc-api-coverages|ogc-api-edr|service-deployment(?:s-state)?|stac|metrics|health|configuration|workflow-ui|service-image\/.*\/(?:links|logs|retry)/;

/**
 * Returns true if the provided error should be returned as JSON.
 * @param err - The error that occurred
 * @param req - The client request
 */
function shouldReturnJson(err: Error, req: HarmonyRequest): boolean {
  // This logic may not make a lot of sense right now, initially this
  // function was added to keep behavior the same as much as possible.
  // With later content-negotiation type tickets we'll change this.
  if (err instanceof RequestValidationError || req.path.match(jsonErrorRoutesRegex)) {
    return true;
  }
  return false;
}

/**
 * Express.js middleware catching errors that escape service protocol handling and sending them
 * to users
 *
 * @param error - The error that occurred
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default function errorHandler(
  error: HttpError, req: HarmonyRequest, res: Response, next: NextFunction,
): void {
  if (res.headersSent) {
    // If the server has started writing the response, delegate to the
    // default error handler, which closes the connection and fails the
    // request
    next(error);
    return;
  }

  const statusCode = getHttpStatusCode(error);
  const message = getEndUserErrorMessage(error);
  const code = getCodeForError(error);

  req.context.logger.error(error);

  if (shouldReturnJson(error, req)) {
    res.status(statusCode).json(buildJsonErrorResponse(code, message));
  } else {
    const response = mustache.render(errorTemplate, { message });
    res.status(statusCode).type('html').send(response);
  }
}
