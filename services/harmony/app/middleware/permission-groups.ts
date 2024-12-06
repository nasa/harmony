import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { ForbiddenError } from '../util/errors';
import { getEdlGroupInformation } from '../util/edl-api';
import { asyncLocalStorage } from '../util/async-store';

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
    const context = asyncLocalStorage.getStore();
    const { isAdmin } = await getEdlGroupInformation(req.user);
    if (isAdmin) {
      context.isAdminAccess = true;
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
 * @param _res - The client response (not used)
 * @param next -  The next function in the middleware chain
 */
export async function core(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): Promise<void> {
  try {
    const context = asyncLocalStorage.getStore();
    const { hasCorePermissions } = await getEdlGroupInformation(req.user);
    if (hasCorePermissions) {
      context.isCoreAccess = true;
      next();
    } else {
      next(new ForbiddenError('You are not permitted to access this resource'));
    }
  } catch (e) {
    next(e);
  }
}
