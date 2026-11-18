import { Response, NextFunction } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { getEdlGroupInformation } from '../util/edl-api';
import { ForbiddenError } from '../util/errors';

/**
 * Middleware to enforce ACLs on admin interfaces.  If the user is part
 * of the admin group, allows the request to go through and adds an 'isAdminAccess'
 * flag to the request context.  If it's not, responds with a 403 forbidden
 * error
 *
 * @param req - The client request
 * @param res - The client response
 * @param next -  The next function in the middleware chain
 */
export async function admin(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { isAdmin } = await getEdlGroupInformation(req.context, req.user);
    if (isAdmin) {
      req.context.isAdminAccess = true;
      next();
    } else {
      next(new ForbiddenError('You are not permitted to access this resource'));
    }
  } catch (e) {
    next(e);
  }
}

/**
 * Middleware to enforce ACLs on admin interfaces that log viewers may also use (see
 * ADMIN_OR_LOG_VIEWER_PATHS). If the user is part of the admin or log viewer group, allows the
 * request to go through, adding the 'isAdminAccess' flag to the request context only for admins.
 * Otherwise responds with a 403 forbidden error.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next -  The next function in the middleware chain
 */
export async function adminOrLogViewer(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { isAdmin, isLogViewer } = await getEdlGroupInformation(req.context, req.user);
    if (isAdmin) {
      req.context.isAdminAccess = true;
    }
    if (isAdmin || isLogViewer) {
      next();
    } else {
      next(new ForbiddenError('You are not permitted to access this resource'));
    }
  } catch (e) {
    next(e);
  }
}

// Admin interfaces that log viewers may use too: the analytics query page and its API
export const ADMIN_OR_LOG_VIEWER_PATHS = /^\/admin\/analytics(\/|$)/;

/**
 * Middleware for every /admin route: requires an admin, except for the paths in
 * ADMIN_OR_LOG_VIEWER_PATHS, which log viewers may also use
 *
 * @param req - The client request
 * @param res - The client response
 * @param next -  The next function in the middleware chain
 */
export async function adminRoutes(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  // originalUrl, since `path` is relative to where this middleware is mounted
  const requestPath = req.originalUrl.split('?')[0];
  if (ADMIN_OR_LOG_VIEWER_PATHS.test(requestPath)) {
    await adminOrLogViewer(req, res, next);
  } else {
    await admin(req, res, next);
  }
}

/**
 * Middleware to enforce ACLs on core interfaces.  If the user is part
 * of the core permissions group, allows the request to go through and adds an 'isCoreAccess'
 * flag to the request context.  If it's not, responds with a 403 forbidden
 * error
 *
 * @param req - The client request
 * @param res - The client response
 * @param next -  The next function in the middleware chain
 */
export async function core(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { hasCorePermissions } = await getEdlGroupInformation(req.context, req.user);
    if (hasCorePermissions) {
      req.context.isCoreAccess = true;
      next();
    } else {
      next(new ForbiddenError('You are not permitted to access this resource'));
    }
  } catch (e) {
    next(e);
  }
}
