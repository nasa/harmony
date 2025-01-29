import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { parseMultiValueParameter } from '../util/parameter-parsing-helpers';
import { normalizeLabel } from '../models/label';
import { keysToLowerCase } from '../util/object';

/**
 * Express.js middleware to convert label parameter to an array (if needed) and add
 * it to the body of the request
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function handleLabelParameter(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  // Check if 'label' exists in the query parameters (GET), form-encoded body, or JSON body
  const lowerCaseQuery = keysToLowerCase(req.query);
  const lowerCaseBody = keysToLowerCase(req.body);
  const label = lowerCaseQuery.label || lowerCaseBody.label;

  // If 'label' exists, convert it to an array (if not already) and assign it to 'label' in the body
  if (label) {
    const labels = parseMultiValueParameter(label);
    const normalizedLabels = labels.map(normalizeLabel);
    for (const lbl of normalizedLabels) {
      if (lbl === '') {
        res.status(400);
        res.send('Labels must contain at least one non-whitespace character');
        return;
      }
    }
    req.body.label = normalizedLabels;
  }

  // Call next to pass control to the next middleware or route handler
  next();
}