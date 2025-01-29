import { NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';

/**
 * Set the request operation extendDimensions value to the default if applicable
 * @param req - The client request
 */
export function setExtendDimensionsDefault(req: HarmonyRequest): void {
  const { operation } = req;
  const extend = req.context.serviceConfig?.capabilities?.extend;
  const defaultExtendDimensions = req.context.serviceConfig?.capabilities?.default_extend_dimensions;

  if (!extend || !defaultExtendDimensions) return;

  // Set extendDimension to the default if the user specified extend=true or the user requested
  // concatenation but did not specify extend dimensions. The case tying it to whether concatenation
  // is requested is temporary - right now ESDC does not support extend directly so we assume if
  // concatenation is requested for a service that supports extend, we also specify extend
  if (
    (operation?.extendDimensions?.length === 1 && operation.extendDimensions[0] === 'true') ||
    (operation.shouldConcatenate && !(operation?.extendDimensions?.length > 0) && req.query?.extend !== 'false')
  ) {
    operation.extendDimensions = defaultExtendDimensions;
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
