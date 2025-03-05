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

  req.context.logger.info('timing.external-validation.start');
  const startTime = new Date().getTime();
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
      req.context.logger.error(`Validation status: ${e.response.status}`);
      req.context.logger.error(`Validation response: ${JSON.stringify(e.response.data, null, 2)}`);
      return next(new ExternalValidationError(e.response.data, e.response.status));
    } else {
      req.context.logger.error(`Error calling validation endpoint: ${url}.`);
      return next(e);
    }
  } finally {
    const durationMs = new Date().getTime() - startTime;
    req.context.logger.info('timing.external-validation.end', { durationMs });
  }

  return next();
}