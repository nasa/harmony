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

export class ConflictError extends HttpError {
  constructor(message = 'Conflict error') {
    super(409, message);
  }
}

interface HttpErrorResponse {
  code: string;
  description?: string;
}

/**
 * Builds an error response to return based on the provided error
 * @param error The HTTP error that occurred
 * @param errorCode An optional string indicated the class of error that occurred
 * @param errorMessage An optional string containing the message to return
 */
export function buildErrorResponse(
  error: HttpError,
  errorCode?: string,
  errorMessage?: string,
): HttpErrorResponse {
  if (!error.code && !errorCode && !errorMessage) {
    return { code: 'harmony.ServerError', description: 'Error: Internal server error.' };
  }

  const code = errorCode || `harmony.${error.constructor ? error.constructor.name : 'UnknownError'}`;
  const message = errorMessage || error.message || error.toString();

  let response;
  try {
    // If the error message is JSON, return it as JSON in the response
    const jsonMessage = JSON.parse(message);
    response = { code, ...jsonMessage };
  } catch (e) {
    response = { code, description: `Error: ${message}` };
  }

  return response;
}
