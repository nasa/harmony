import axios from 'axios';
import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { buildJsonErrorResponse } from '../util/errors';

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
      const statusCode = e.response.status;
      res.status(statusCode).json(buildJsonErrorResponse(statusCode, e.response.data));
      req.context.logger.error(`[${statusCode}] ${e.response.data}`);
    } else {
      req.context.logger.error(e);
      return next(e);
    }
    return;
  }

  return next();
}