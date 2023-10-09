import { NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';

/**
 * Express.js middleware that inject default extend parameter into operation if applicable
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function extendDefault(req: HarmonyRequest, res, next: NextFunction): Promise<void> {
  try {
    const extend = req.context.serviceConfig?.capabilities?.extend;
    const default_extend_dimensions = req.context.serviceConfig?.capabilities?.default_extend_dimensions;
    // set extendDimension to the default if there is one configured and no provided value
    if (extend && default_extend_dimensions && !req.operation?.extendDimensions) {
      req.operation.extendDimensions = default_extend_dimensions;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export = extendDefault;
