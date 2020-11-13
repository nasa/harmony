import { NextFunction, Response } from 'express';
import { ServiceConfig } from '../models/services/base-service';
import HarmonyRequest from '../models/harmony-request';
import { chooseServiceConfig } from '../models/services';

/**
 * Middleware to set the service that should be used for the given request
 * @param req The client request, containing an operation
 * @param res The client response
 * @param next The next function in the middleware chain
 */
export default function chooseService(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const { operation, context } = req;
  if (!operation?.sources) {
    return next();
  }

  let serviceConfig: ServiceConfig<unknown>;
  try {
    serviceConfig = chooseServiceConfig(operation, context);
  } catch (e) {
    return next(e);
  }
  context.serviceConfig = serviceConfig;
  return next();
}
