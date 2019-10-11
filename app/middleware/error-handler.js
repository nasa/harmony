const mustache = require('mustache');
const fs = require('fs');
const path = require('path');

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
module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // If the server has started writing the response, delegate to the
    // default error handler, which closes the connection and fails the
    // request
    next(err);
    return;
  }

  const message = err.message || err.toString();
  const response = mustache.render(errorTemplate, { message });
  const code = err.code || 500;

  res.status(code).type('html').send(response);
};
