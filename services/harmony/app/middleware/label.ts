import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { parseMultiValueParameter } from '../util/parameter-parsing-helpers';

/**
 * Express.js middleware to convert label parameter to an array (if needed) and add
 * it to the body of the request
 *
 * @param req - The client request
 * @param _res - The client response (not used)
 * @param next - The next function in the middleware chain
 */
export default async function handleLabelParameter(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): Promise<void> {
  // Check if 'label' exists in the query parameters (GET), form-encoded body, or JSON body
  let label = req.query.label || req.body.label;

  // If 'label' exists, convert it to an array (if not already) and assign it to 'label' in the body
  if (label) {
    label = parseMultiValueParameter(label);
    req.body.label = label;
  }

  // Call next to pass control to the next middleware or route handler
  next();
}