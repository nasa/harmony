import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { ForbiddenError } from '../util/errors';
import { getEdlGroupInformation } from '../util/edl-api';

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
    const { isAdmin } = await getEdlGroupInformation(req.user, req.context.logger);
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
    const { hasCorePermissions } = await getEdlGroupInformation(req.user, req.context.logger);
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
