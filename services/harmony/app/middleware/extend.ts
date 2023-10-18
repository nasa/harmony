import { NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';

/**
 * Set the request operation extendDimensions value to the default if applicable
 * @param req - The client request
 */
export function setExtendDimensionsDefault(req: HarmonyRequest): void {
  const extend = req.context.serviceConfig?.capabilities?.extend;
  const defaultExtendDimensions = req.context.serviceConfig?.capabilities?.default_extend_dimensions;
  // set extendDimension to the default if there is one configured and no provided value
  if (extend && defaultExtendDimensions && !req.operation?.extendDimensions) {
    req.operation.extendDimensions = defaultExtendDimensions;
  }
}

/**
 * Express.js middleware that inject default extend parameter into operation if applicable
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function extendDefault(req: HarmonyRequest, res, next: NextFunction): Promise<void> {
  try {
    setExtendDimensionsDefault(req);
    next();
  } catch (error) {
    next(error);
  }
}
