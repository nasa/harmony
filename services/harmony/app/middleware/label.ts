import { Response, NextFunction } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { normalizeLabel } from '../models/label';
import { keysToLowerCase } from '../util/object';
import { parseMultiValueParameter } from '../util/parameter-parsing-helpers';

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
  // POST handlers merge the body into the query, so check the body to determine the source
  const isFromBody = lowerCaseBody.label !== undefined;
  const label = isFromBody ? lowerCaseBody.label : lowerCaseQuery.label;

  // If 'label' exists, convert it to an array (if not already) and assign it to 'label' in the body
  if (label) {
    // Labels may contain commas. A comma-separated string in a form or JSON body is split into
    // multiple labels. A query string value is not split further, since the query parser already
    // splits on literal commas, so any remaining comma was URL-encoded (%2C) and is part of the
    // label. The values of an array are never split.
    let labels: string[];
    if (isFromBody) {
      labels = parseMultiValueParameter(label, false);
    } else {
      labels = label instanceof Array ? label : [label];
    }
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
