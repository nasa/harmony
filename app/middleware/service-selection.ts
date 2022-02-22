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
  const collections = req.collections || [];
  // for every collection in the request...
  for (const coll of collections) {
    const services = coll.associations?.services || [];
    // for every service associated with the current collection...
    for (const serviceId of services) {
      for (const config of configs) {
        // if the service config contains a 'umm_s' entry that includes the current service id
        if (config.umm_s?.includes(serviceId)) {
          if (config.collections) {
            if (!config.collections.map((sc) => sc.id).includes(coll.id)) {
              // add the collection to the service config if it isn't there already
              config.collections.push({ id: coll.id });
            }
          } else {
            // create the collections array using the collection id - this is for the case
            // where no collections are declared for a service in services.yml
            config.collections = [{ id: coll.id }];
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
  // setCollectionGranuleLimitMessage(req);
  return next();
}
