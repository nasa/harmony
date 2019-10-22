/* eslint-disable max-classes-per-file */ // This file creates multiple tag classes

class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class NotFoundError extends HttpError {
  constructor(message = 'The requested resource could not be found') {
    super(404, message);
  }
}

class ServerError extends HttpError {
  constructor(message = 'An unexpected error occurred') {
    super(500, message);
  }
}

class RequestValidationError extends HttpError {
  constructor(message = 'Invalid request') {
    super(400, message);
  }
}

module.exports = {
  HttpError,
  NotFoundError,
  ServerError,
  RequestValidationError,
};
