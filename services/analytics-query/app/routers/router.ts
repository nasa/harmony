import { createHash, timingSafeEqual } from 'crypto';

import express, { NextFunction, Request, Response } from 'express';
import { Logger } from 'winston';

import { AnalyticsDb } from '../query/analytics-db';
import { executeQuery, ParameterValue, QueryLimits, withDeadline } from '../query/execute';
import { loadSchema, SchemaCache, SchemaInfo, tableNames } from '../query/schema';
import { validateSql } from '../query/validate';
import { HttpError, RequestValidationError, UnauthorizedError } from '../util/errors';

// The header the harmony frontend puts the (already authorized) user's username in, for the audit log
export const USER_HEADER = 'x-harmony-user';

export interface RouterOptions {
  db: AnalyticsDb;
  schemaCache: SchemaCache;
  limits: QueryLimits;
  sharedSecret: string;
  logger: Logger;
}

/**
 * Compare two strings in constant time (for the given lengths)
 */
function secretsMatch(given: string, expected: string): boolean {
  // Hashing first makes the inputs the same length, which timingSafeEqual requires
  const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Get the query from a request body
 *
 * @throws RequestValidationError if it is missing or not a string
 */
function requestSql(body: unknown): string {
  const sql = (body as { sql?: unknown })?.sql;
  if (typeof sql !== 'string') {
    throw new RequestValidationError('The request body must have a "sql" string');
  }
  return sql;
}

/**
 * Get the parameter values from a request body
 *
 * @throws RequestValidationError if they aren't an object
 */
function requestParams(body: unknown): Record<string, ParameterValue> {
  const params = (body as { params?: unknown })?.params ?? {};
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new RequestValidationError('"params" must be an object mapping parameter names to values');
  }
  return params as Record<string, ParameterValue>;
}

/**
 * Get the row limit from a request body: how many rows to return at most, which can't be more than
 * the service's own maximum (ANALYTICS_QUERY_MAX_ROWS)
 *
 * @param body - the request body
 * @param maxRows - the service's maximum
 * @returns the limit (the maximum if the request gives none)
 * @throws RequestValidationError if it isn't a whole number from 1 to maxRows
 */
function requestLimit(body: unknown, maxRows: number): number {
  const limit = (body as { limit?: unknown })?.limit;
  if (limit === undefined || limit === null) return maxRows;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxRows) {
    throw new RequestValidationError(`"limit" must be a whole number of rows from 1 to ${maxRows}`);
  }
  return limit;
}

/**
 * Set up routes for the service: health checks for Kubernetes, and the query API for the harmony
 * frontend
 *
 * @param options - the instance, schema cache, limits, shared secret and logger to use
 * @returns Router configured with service routes.
 */
export default function router(options: RouterOptions): express.Router {
  const { db, schemaCache, limits, sharedSecret, logger } = options;
  const result = express.Router();

  const getSchema = (): Promise<SchemaInfo> => schemaCache.get(() => db.withConnection(loadSchema));

  result.get('/liveness', (_req, res) => {
    res.send('OK');
  });

  // Not ready until the catalog is attached, so k8s doesn't route queries to a pod that can't run them
  result.get('/readiness', (_req, res) => {
    if (db.isReady) {
      res.send('OK');
    } else {
      res.status(503).send('Not ready');
    }
  });

  // Everything under /api is only for the harmony frontend
  result.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || !secretsMatch(token, sharedSecret)) {
      next(new UnauthorizedError());
    } else if (!req.get(USER_HEADER)) {
      next(new RequestValidationError(`The ${USER_HEADER} header is required`));
    } else {
      next();
    }
  });
  result.use('/api', express.json({ limit: '256kb' }));

  result.get('/api/schema', async (_req, res, next) => {
    try {
      // With the limits a query can ask for, so the page can offer them
      res.json({ ...(await getSchema()), limits: { maxRows: limits.maxRows } });
    } catch (e) {
      next(e);
    }
  });

  result.post('/api/validate', async (req, res, next) => {
    try {
      const sql = requestSql(req.body);
      const allowed = tableNames(await getSchema());
      res.json(await db.withConnection((conn) => validateSql(conn, sql, allowed)));
    } catch (e) {
      next(e);
    }
  });

  result.post('/api/query', async (req, res, next) => {
    const user = req.get(USER_HEADER);
    const startMs = Date.now();
    let sql: string;
    let params: Record<string, ParameterValue>;
    try {
      sql = requestSql(req.body);
      params = requestParams(req.body);
      const maxRows = requestLimit(req.body, limits.maxRows);
      const allowed = tableNames(await getSchema());
      // The time limit covers validating the query as well as running it, since preparing it can
      // take a while too (e.g. loading Iceberg table metadata). It starts once the query has a
      // connection, not while it waits for one.
      const queryResult = await db.withConnection((conn) => withDeadline(conn, limits.timeoutMs, async (deadline) => {
        // Validated on the same connection it runs on, every time - never trust an earlier check
        const validation = await validateSql(conn, sql, allowed);
        if (!validation.valid) {
          throw new RequestValidationError('The query is not valid', validation.errors);
        }
        // The query runs without a LIMIT of its own being needed: reading stops at the limit
        return executeQuery(conn, sql, params, { ...limits, maxRows }, deadline);
      }));
      logger.info(`Analytics query by ${user}: success`, {
        user, sql, params, limit: req.body?.limit, outcome: 'success', rowCount: queryResult.rowCount,
        truncated: queryResult.truncated, durationMs: Date.now() - startMs,
      });
      res.json(queryResult);
    } catch (e) {
      const outcome = e instanceof HttpError && e.status < 500 ? 'rejected' : 'error';
      logger.info(`Analytics query by ${user}: ${outcome} (${e.message})`, {
        user, sql, params, outcome, error: e.message, durationMs: Date.now() - startMs,
      });
      next(e);
    }
  });

  // Errors are reported as JSON. Anything that isn't an HttpError is unexpected, so its details are
  // logged rather than returned.
  result.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.status, message: err.message, errors: err.errors });
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ code: 400, message: 'The request body is not valid JSON', errors: [] });
    } else if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ code: 413, message: 'The request body is too large', errors: [] });
    } else {
      logger.error(err);
      res.status(500).json({ code: 500, message: 'An unexpected error occurred', errors: [] });
    }
  });

  return result;
}
