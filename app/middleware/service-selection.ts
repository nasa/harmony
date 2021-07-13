import { NextFunction, Response } from 'express';
import { ServiceConfig } from '../models/services/base-service';
import HarmonyRequest from '../models/harmony-request';
import { chooseServiceConfig, getServiceConfigs } from '../models/services';

/**
 * Add collections to service configs
 * @param req - The client request
 * @returns An array of service configurations
 */
function addCollectionsToServicesByAssociation(req: HarmonyRequest): ServiceConfig<unknown>[] {
  const configs = getServiceConfigs();
  const { collections } = req;
  if (collections) {
    for (const coll of collections) {
      if (coll.associations?.services) {
        for (const serviceId of coll.associations?.services) {
          for (const config of configs) {
            if (config.umm_s?.includes(serviceId)
              && config.collections
              && !config.collections.includes(coll.id)) {
              // add the collection to the service config
              config.collections.push(coll.id);
            }
          }
        }
      }
    }
  }

  return configs;
}

/**
 * Middleware to set the service that should be used for the given request
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default function chooseService(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const { operation, context } = req;
  if (!operation?.sources) {
    return next();
  }

  let serviceConfig: ServiceConfig<unknown>;
  const configs = addCollectionsToServicesByAssociation(req);
  try {
    serviceConfig = chooseServiceConfig(operation, context, configs);
  } catch (e) {
    return next(e);
  }
  context.serviceConfig = serviceConfig;
  return next();
}
