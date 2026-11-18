import axios from 'axios';
import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
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
  res.render('analytics', { version: harmonyVersion });
}

/**
 * Express.js handler that passes /admin/analytics/api/:endpoint requests on to the analytics query
 * service (services/analytics-query), adding the shared secret and the requesting user, and
 * returns its response as-is. Access to this route has already been checked (admins and log
 * viewers only).
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
