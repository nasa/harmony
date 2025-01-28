import { NextFunction, Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { RequestValidationError } from '../util/errors';
import DataOperation, { DataSource } from '../models/data-operation';
import { ServiceCollection, ServiceConfig } from '../models/services/base-service';
import { partial } from 'lodash';

/**
 * Determines whether or not a given ServiceCollection supports a given DataSource, i.e.,
 * the Service Collection has a matching collection id and variables
 *
 * @param source - The DataSource from an operation
 * @param servColl - The ServiceCollection defined in services.yml
 * @returns `true` if the collections are the same and if variables are not defined
 * for the service collection or all the variables in the source are also in the service
 * collection, `false` otherwise
 */
function isServiceCollectionMatch(source: DataSource, servColl: ServiceCollection): boolean {
  return servColl.id === source.collection &&
    (!servColl.variables || source.variables?.every((v) => servColl.variables?.includes(v.id)));
}

/**
 * Returns true if all of the collections in the given operation can be operated on by
 * the given service.
 *
 * @param operation - The operation to match
 * @param serviceConfig - A configuration for a single service from services.yml
 * @returns true if all collections in the operation are compatible with the service and
 *     false otherwise
 */
function isEveryVariableSupported(
  operation: DataOperation,
  serviceConfig: ServiceConfig<unknown>,
): boolean {
  return serviceConfig.capabilities?.all_collections || operation.sources.every((source) => {
    const rval = serviceConfig.collections?.some(partial(isServiceCollectionMatch, source));
    return rval;
  });
}

/**
 * Middleware to only allow a subset of UMM-Var variables to be used with a service chain
 * with the list of variables configured in services.yml
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default function validateRestrictedVariables(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const { operation, context } = req;
  if (!operation?.sources) {
    return next();
  }
  if (!isEveryVariableSupported(operation, context.serviceConfig)) {
    const error = new RequestValidationError('Not all variables selected can be subset');
    return next(error);
  }
  return next();
}