import axios from 'axios';
import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { ExternalValidationError } from '../util/errors';

/**
 * Middleware to validate users against an external endpoint configured for a service.
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export async function externalValidation(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { operation, context } = req;
  const url = context?.serviceConfig?.external_validation_url;
  if (!url) return next();

  try {
    await axios.post(
      url,
      operation,
      {
        headers: {
          'Authorization': `Bearer: ${req.accessToken}`,
        },
      },
    );
  } catch (e) {
    req.context.logger.error('External validation failed');
    if (e.response) {
      return next(new ExternalValidationError(e.response.data, e.response.status));
    } else {
      req.context.logger.error('THROWING 500 ERROR');
      req.context.logger.error(JSON.stringify(e, null, 2));
      req.context.logger.error(e);
      return next(e);
    }
  }

  return next();
}