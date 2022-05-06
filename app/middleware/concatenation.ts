import { NextFunction, Response } from 'express';
import { ParameterParseError, parseBoolean } from '../util/parameter-parsing';
import HarmonyRequest from '../models/harmony-request';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';

/**
 * Middleware to determine whether the request should concatenate results. Called prior
 * to choosing the service that will be used.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export function preServiceConcatenationHandler(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const query = keysToLowerCase(req.query);
  const { operation } = req;

  if (!operation) {
    return next();
  }

  try {
    operation.shouldConcatenate = parseBoolean(query.concatenate);
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      next(new RequestValidationError(`query parameter "concatenate" ${e.message}`));
    }
    next(e);
  }

  return next();
}

/**
 * Middleware to determine whether the request should concatenate results. Called after
 * choosing the service that will be used to handle a special case where certain services
 * should concatenate by default.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export function postServiceConcatenationHandler(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const query = keysToLowerCase(req.query);
  const { operation, context } = req;

  if (!operation) {
    return next();
  }

  if (context.serviceConfig.capabilities.concatenate_by_default) {
    if (query.concatenate?.toLowerCase() === 'false') {
      operation.shouldConcatenate = false;
    } else {
      operation.shouldConcatenate = true;
    }
  }

  return next();
}
