/**
 * A problem with a query, with the character offset in the query it applies to when known
 */
export interface QueryProblem {
  message: string;
  position: number | null;
}

/**
 * An error the API reports to the caller with a specific HTTP status
 */
export class HttpError extends Error {
  constructor(public status: number, message: string, public errors: QueryProblem[] = []) {
    super(message);
  }
}

/**
 * The request (or the query in it) was rejected
 */
export class RequestValidationError extends HttpError {
  constructor(message: string, errors: QueryProblem[] = []) {
    super(400, message, errors);
  }
}

/**
 * The caller didn't present the shared secret
 */
export class UnauthorizedError extends HttpError {
  constructor(message = 'Missing or invalid credentials') {
    super(401, message);
  }
}

/**
 * Too many queries are already running or waiting
 */
export class BusyError extends HttpError {
  constructor(message = 'Too many analytics queries are running, try again shortly') {
    super(503, message);
  }
}

/**
 * The DuckDB instance isn't ready yet (or couldn't be set up)
 */
export class NotReadyError extends HttpError {
  constructor(message = 'The analytics catalog is not available yet') {
    super(503, message);
  }
}

/**
 * The query ran past the time limit and was interrupted
 */
export class QueryTimeoutError extends HttpError {
  constructor(timeoutMs: number) {
    super(408, `The query was stopped after running for ${timeoutMs / 1000} seconds`);
  }
}
