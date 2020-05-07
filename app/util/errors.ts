/* eslint-disable max-classes-per-file */ // This file creates multiple tag classes

export class HttpError extends Error {
  code: number;

  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Class for errors returned by the CMR
export class CmrError extends HttpError {}

// Tag class for backend errors
export class ServiceError extends HttpError {}

export class NotFoundError extends HttpError {
  constructor(message = 'The requested resource could not be found') {
    super(404, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You are not authorized to access the requested resource') {
    super(403, message);
  }
}

export class ServerError extends HttpError {
  constructor(message = 'An unexpected error occurred') {
    super(500, message);
  }
}

export class RequestValidationError extends HttpError {
  constructor(message = 'Invalid request') {
    super(400, message);
  }
}
