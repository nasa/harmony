import axios from 'axios';
import { NextFunction, Response } from 'express';

import AnalyticsQuery, {
  deleteAnalyticsQuery, getAnalyticsQueries, getAnalyticsQueryById, nameIsTaken,
} from '../models/analytics-query';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import env from '../util/env';
import harmonyVersion from '../util/version';

// The analytics query service endpoints the page may call, by method
const PROXIED_ENDPOINTS = {
  GET: new Set(['schema']),
  POST: new Set(['validate', 'query']),
};

/**
 * Express.js handler for the analytics query page. It is only a shell - it gets everything from
 * the API below.
 *
 * @param req - The client request
 * @param res - The client response
 */
export async function getAnalyticsPage(req: HarmonyRequest, res: Response): Promise<void> {
  req.context.logger.info(`Analytics page requested by user ${req.user}`);
  // Who the user is decides which saved queries the page offers to change or delete. The API
  // enforces this - the page only uses it to show the right buttons.
  res.render('analytics', { version: harmonyVersion, username: req.user, isAdmin: !!req.context.isAdminAccess });
}

/**
 * Express.js handler that passes /admin/analytics/api/:endpoint requests on to the analytics query
 * service (services/analytics-query), adding the shared secret and the requesting user, and
 * returns its response as-is. Access to this route has already been checked (admins only, like
 * every /admin route).
 *
 * POSTs must have a JSON body. Besides being what the service expects, this keeps another site from
 * running queries as a logged-in user with a cross-site form: a cross-site JSON request needs a
 * CORS preflight that allows credentials, which harmony never grants.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export async function proxyAnalyticsApi(req: HarmonyRequest, res: Response, next: NextFunction): Promise<void> {
  const { endpoint } = req.params;
  if (!PROXIED_ENDPOINTS[req.method]?.has(endpoint)) {
    res.status(404).json({ code: 404, message: `There is no analytics API endpoint ${req.method} ${endpoint}`, errors: [] });
    return;
  }
  if (req.method === 'POST' && !req.is('application/json')) {
    res.status(415).json({ code: 415, message: 'The request body must be JSON (Content-Type: application/json)', errors: [] });
    return;
  }

  try {
    const response = await axios.request({
      method: req.method,
      url: `${env.analyticsQueryUrl.replace(/\/$/, '')}/api/${endpoint}`,
      headers: {
        Authorization: `Bearer ${env.analyticsQuerySharedSecret}`,
        'x-harmony-user': req.user,
      },
      data: req.method === 'POST' ? req.body : undefined,
      timeout: env.analyticsQueryRequestTimeoutMs,
      // Pass the service's errors (e.g. a 400 for an invalid query) through rather than throwing
      validateStatus: () => true,
    });
    res.status(response.status).json(response.data);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      // The service couldn't be reached, or took too long
      req.context.logger.error(`Could not reach the analytics query service at ${env.analyticsQueryUrl}: ${e.message}`);
      const message = e.code === 'ECONNABORTED'
        ? 'The analytics query service took too long to respond'
        : 'The analytics query service is not available';
      res.status(503).json({ code: 503, message, errors: [] });
    } else {
      next(e);
    }
  }
}

//
// Saved queries. These are served by harmony itself, from the jobs database, rather than by the
// analytics query service, which only runs queries.
//

/**
 * Respond with an error in the same shape as the analytics query service's, which the page expects
 */
export function sendError(res: Response, status: number, message: string, errors: string[] = []): void {
  res.status(status).json({ code: status, message, errors: errors.map((e) => ({ message: e, position: null })) });
}

/**
 * Get the saved query a request's :id names. Another user's private query is treated as if it
 * didn't exist, so its id doesn't reveal that it does.
 *
 * @returns the query, or undefined (having responded with a 404) if there is none the user can see
 */
async function requestedQuery(req: HarmonyRequest, res: Response): Promise<AnalyticsQuery | undefined> {
  let query = /^\d+$/.test(req.params.id) ? await getAnalyticsQueryById(db, Number(req.params.id)) : undefined;
  if (query && !query.isVisibleTo(req.user)) query = undefined;
  if (!query) {
    sendError(res, 404, `There is no saved query with id ${req.params.id}`);
  }
  return query;
}

/**
 * Set a query's fields from a request body, leaving out any that aren't in it
 *
 * @returns problems with the body
 */
function applyBody(query: AnalyticsQuery, body: { [key: string]: unknown }): string[] {
  const problems: string[] = [];
  for (const field of ['name', 'description', 'sql']) {
    if (body[field] === undefined) continue;
    if (field === 'description' && body[field] === null) {
      query.description = null;
    } else if (typeof body[field] !== 'string') {
      problems.push(`${field} must be a string`);
    } else {
      query[field] = field === 'name' ? (body[field] as string).trim() : body[field];
    }
  }
  if (body.parameters !== undefined) {
    try {
      query.setParameters(body.parameters);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (body.chart !== undefined) {
    try {
      query.setChart(body.chart);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (body.rowLimit !== undefined) {
    try {
      query.setRowLimit(body.rowLimit);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (body.shared !== undefined) {
    if (typeof body.shared !== 'boolean') {
      problems.push('shared must be true or false');
    } else {
      query.shared = body.shared;
    }
  }
  return problems.concat(problems.length === 0 ? query.validate() ?? [] : []);
}

/**
 * Express.js handler that lists the saved queries the user can see: their own, and everyone's shared
 * ones
 */
export async function listAnalyticsQueries(req: HarmonyRequest, res: Response): Promise<void> {
  const queries = await getAnalyticsQueries(db, req.user);
  res.json({ queries: queries.map((q) => q.serialize()) });
}

/**
 * Express.js handler that gets one saved query
 */
export async function getAnalyticsQuery(req: HarmonyRequest, res: Response): Promise<void> {
  const query = await requestedQuery(req, res);
  if (query) res.json(query.serialize());
}

/**
 * Express.js handler that saves a new query, owned by the requesting user and private to them
 * unless the body has shared: true
 */
export async function createAnalyticsQuery(req: HarmonyRequest, res: Response): Promise<void> {
  if (!req.is('application/json')) {
    sendError(res, 415, 'The request body must be JSON (Content-Type: application/json)');
    return;
  }
  const query = new AnalyticsQuery({ username: req.user, shared: false });
  const problems = applyBody(query, req.body ?? {});
  if (problems.length > 0) {
    sendError(res, 400, 'The query could not be saved', problems);
    return;
  }
  await db.transaction(async (tx) => {
    if (await nameIsTaken(tx, req.user, query.name)) {
      sendError(res, 409, `You already have a saved query named "${query.name}"`);
      return;
    }
    await query.save(tx);
    req.context.logger.info(`User ${req.user} saved analytics query ${query.id} "${query.name}"`);
    res.status(201).json(query.serialize());
  });
}

/**
 * Express.js handler that changes a saved query - only its owner or an admin may
 */
export async function updateAnalyticsQuery(req: HarmonyRequest, res: Response): Promise<void> {
  if (!req.is('application/json')) {
    sendError(res, 415, 'The request body must be JSON (Content-Type: application/json)');
    return;
  }
  const query = await requestedQuery(req, res);
  if (!query) return;
  if (!query.canBeChangedBy(req.user, !!req.context.isAdminAccess)) {
    sendError(res, 403, `Only ${query.username} (or an admin) can change this query - save it under a new name instead`);
    return;
  }
  const problems = applyBody(query, req.body ?? {});
  if (problems.length > 0) {
    sendError(res, 400, 'The query could not be saved', problems);
    return;
  }
  await db.transaction(async (tx) => {
    if (await nameIsTaken(tx, query.username, query.name, query.id)) {
      sendError(res, 409, `${query.username} already has a saved query named "${query.name}"`);
      return;
    }
    const { name, description, sql, parameters, chart, row_limit, shared } = query;
    await query.save(tx, { name, description, sql, parameters, chart, row_limit, shared });
    req.context.logger.info(`User ${req.user} updated analytics query ${query.id} "${query.name}"`);
    res.json(query.serialize());
  });
}

/**
 * Express.js handler that deletes a saved query - only its owner or an admin may
 */
export async function deleteAnalyticsQueryHandler(req: HarmonyRequest, res: Response): Promise<void> {
  const query = await requestedQuery(req, res);
  if (!query) return;
  if (!query.canBeChangedBy(req.user, !!req.context.isAdminAccess)) {
    sendError(res, 403, `Only ${query.username} (or an admin) can delete this query`);
    return;
  }
  await deleteAnalyticsQuery(db, query.id);
  req.context.logger.info(`User ${req.user} deleted analytics query ${query.id} "${query.name}"`);
  res.status(204).end();
}
