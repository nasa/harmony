import { NextFunction, Response } from 'express';

import { camelCaseToSpacedTitleCase, listToText } from '@harmony/util/string';

import HarmonyRequest from '../models/harmony-request';
import { getCountsByService } from '../models/user-work';
import db from '../util/db';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';
import { WorkItemQueueType } from '../util/queue/queue';
import { getQueueForType, getWorkSchedulerQueue } from '../util/queue/queue-factory';
import { getImageToServiceMap, getServiceName } from '../util/service-images';
import harmonyVersion from '../util/version';

export const currentApiVersion = '1-alpha';
const supportedApiVersions = ['1-alpha'];

/**
 * Throws an error if the version is not supported
 * @param version - the version of the dashboard response
 * @throws RequestValidationError if the version is not supported
 */
function validateVersion(version): void {
  const normalizedVersion = version.toLowerCase();

  const isSupported = supportedApiVersions.some(
    v => v.toLowerCase() === normalizedVersion,
  );

  if (!isSupported) {
    const message = `Invalid API version. Supported versions are: ${listToText(supportedApiVersions)}`;
    throw new RequestValidationError(message);
  }
}

/**
 * Express.js handler that returns the harmony dashboard responding with JSON by default
 * or HTML if requested.
 */
export async function getDashboard(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const query = keysToLowerCase(req.query);
  const version = query?.version;
  const versionText = version ? version : 'unspecified';

  try {
    if (version !== undefined) {
      validateVersion(version);
    }

    req.context.logger.info(`Dashboard requested by user ${req.user}, version: ${versionText}`);
    const serviceWorkCounts = await getCountsByService(db);
    const imageToServiceMap = getImageToServiceMap();

    // Convert the image name returned from the database with the service name
    const normalizedDb: Record<string, { queued: number }> = {};

    for (const [image, value] of Object.entries(serviceWorkCounts)) {
      const service = getServiceName(imageToServiceMap, image);

      if (!normalizedDb[service]) {
        normalizedDb[service] = { queued: 0 };
      }

      normalizedDb[service].queued += value.queued;
    }

    // Build full service set from imageToServiceMap (VALUES are service names)
    // Include all deployed services in the response - not just the ones with active requests
    const allServices = new Set(Object.values(imageToServiceMap));
    const merged: Record<string, { queued: number }> = {};

    for (const service of allServices) {
      merged[service] = {
        queued: normalizedDb[service]?.queued ?? 0,
      };
    }

    // Add any unknown services returned from DB (could be from old images)
    for (const [service, value] of Object.entries(normalizedDb)) {
      if (!(service in merged)) {
        merged[service] = value;
      }
    }

    const sortedServicesMap = Object.keys(merged).sort().reduce((acc, key) => ({
      ...acc,
      [key]: merged[key],
    }), {});

    const smallUpdateQueue = getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE);
    const largeUpdateQueue = getQueueForType(WorkItemQueueType.LARGE_ITEM_UPDATE);
    const schedulerQueue = getWorkSchedulerQueue();

    const smallUpdateQueueCount = await smallUpdateQueue.getApproximateNumberOfMessages();
    const largeUpdateQueueCount = await largeUpdateQueue.getApproximateNumberOfMessages();
    const schedulerQueueCount = await schedulerQueue.getApproximateNumberOfMessages();

    const queues = {
      'smallWorkItemUpdates': smallUpdateQueueCount,
      'largeWorkItemUpdates': largeUpdateQueueCount,
      'workItemScheduler': schedulerQueueCount,
    };

    const result = {
      services: sortedServicesMap,
      queues,
      version: version?.toLowerCase() || currentApiVersion,
    };

    // Detect if client wants HTML explicitly - by default we will return JSON
    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (acceptsHtml) {
      // Transform the object { "service": { "queued": 0 } }
      // into an array [{ "name": "service", "queued": 0 }]
      const servicesArray = Object.entries(result.services).map(([name, details]) => ({
        name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queued: (details as any).queued,
      }));

      const queuesArray = Object.entries(result.queues).map(([name, queuedCount]) => ({
        name: camelCaseToSpacedTitleCase(name),
        count: queuedCount,
      }));

      // Sort by queued count descending for the default page load
      servicesArray.sort((a, b) => b.queued - a.queued);

      res.render('dashboard', {
        version: harmonyVersion,
        services: servicesArray,
        queues: queuesArray,
      });
    } else {
      res.json(result);
    }

  } catch (e) {
    next(e);
  }
}
