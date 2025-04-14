import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { chooseServiceConfig, getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import { CmrCollection } from '../util/cmr';
import env from '../util/env';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';

/**
 * Add collections to service configs
 * @param collections - A list of CMR collections
 * @returns An array of service configurations
 */
export function addCollectionsToServicesByAssociation(collections: CmrCollection[]): ServiceConfig<unknown>[] {
  const configs = getServiceConfigs();
  if (collections) {
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

  const query = keysToLowerCase(req.query);
  let serviceConfig: ServiceConfig<unknown>;

  try {
    // If the user provided a serviceId choose it using the UMM-S concept ID or name of the chain in services.yml
    if (query.serviceid) {
      if (!env.allowServiceSelection) {
        throw new RequestValidationError('Requesting a service chain using serviceId is disabled in this environment.');
      }

      const configs = getServiceConfigs();
      serviceConfig = configs.find(config => config.umm_s === query.serviceid || config.name === query.serviceid);

      if (!serviceConfig) {
        throw new RequestValidationError('Could not find a service chain that matched the provided serviceId. Ensure the provided serviceId is either a CMR concept ID or the name of the chain in services.yml');
      }

      // Need to add the collection(s) to the service config or later middleware may run into issus
      for (const collection of req.context.collectionIds) {
        serviceConfig.collections.push({ id: collection });
      }
    } else {
      const configs = addCollectionsToServicesByAssociation(req.context.collections);
      serviceConfig = chooseServiceConfig(operation, context, configs);
    }
    context.serviceConfig = serviceConfig;
    return next();
  } catch (e) {
    return next(e);
  }
}
