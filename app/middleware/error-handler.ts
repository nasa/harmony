import mustache from 'mustache';
import fs from 'fs';
import path from 'path';
import { RequestValidationError } from 'util/errors';

const errorTemplate = fs.readFileSync(path.join(__dirname, '../templates/server-error.mustache.html'), { encoding: 'utf8' });

/**
 * Express.js middleware catching errors that escape service protocol handling and sending them
 * to users
 *
 * @param {Error} err The error that occurred
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 */
export default function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // If the server has started writing the response, delegate to the
    // default error handler, which closes the connection and fails the
    // request
    next(err);
    return;
  }

  if (err instanceof RequestValidationError) {
    req.context.logger.error(err.message);
    res.status(400).json({
      errors: [err.message],
    });
  } else {
    const message = err.message || err.toString();
    const response = mustache.render(errorTemplate, { message });
    let code = (+err.code) || 500;
    if (code < 400 || code >= 600) {
      // Need to check that the provided code is in a valid range due to some errors
      // providing a non-http code.
      code = 500;
    }

    res.status(code).type('html').send(response);
  }
}
