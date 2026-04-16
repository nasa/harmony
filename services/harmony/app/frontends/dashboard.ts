import { NextFunction, Response } from 'express';
import { Knex } from 'knex';

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
 *
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

interface ServiceMetric {
  queued: number;
}

interface DashboardQueues {
  smallWorkItemUpdates: number;
  largeWorkItemUpdates: number;
  workItemScheduler: number;
}

/**
 * Fetches and merges service work counts from the database, mapping image names
 * to service names and ensuring all known services are included.
 *
 * @param dbConn - The database connection object
 * @returns A record of service names and their associated queued work counts
 */
async function getServiceMetrics(dbConn: Knex): Promise<Record<string, ServiceMetric>> {
  const serviceWorkCounts = await getCountsByService(dbConn);
  const imageToServiceMap = getImageToServiceMap();

  const normalizedDb: Record<string, ServiceMetric> = {};

  for (const [image, value] of Object.entries(serviceWorkCounts)) {
    const service = getServiceName(imageToServiceMap, image);
    if (!normalizedDb[service]) {
      normalizedDb[service] = { queued: 0 };
    }
    normalizedDb[service].queued += (value as ServiceMetric).queued;
  }

  const allServices = new Set(Object.values(imageToServiceMap));
  const merged: Record<string, ServiceMetric> = {};

  for (const service of allServices) {
    merged[service] = { queued: normalizedDb[service]?.queued ?? 0 };
  }

  for (const [service, value] of Object.entries(normalizedDb)) {
    if (!(service in merged)) {
      merged[service] = value;
    }
  }

  return Object.keys(merged).sort().reduce((acc, key) => ({
    ...acc,
    [key]: merged[key],
  }), {});
}

/**
 * Fetches approximate message counts for internal system queues.
 *
 * @returns A record containing counts for small updates, large updates, and the scheduler
 */
async function getSystemQueueMetrics(): Promise<DashboardQueues> {
  const smallUpdateQueue = getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE);
  const largeUpdateQueue = getQueueForType(WorkItemQueueType.LARGE_ITEM_UPDATE);
  const schedulerQueue = getWorkSchedulerQueue();

  const [small, large, scheduler] = await Promise.allSettled([
    smallUpdateQueue.getApproximateNumberOfMessages(),
    largeUpdateQueue.getApproximateNumberOfMessages(),
    schedulerQueue.getApproximateNumberOfMessages(),
  ]);

  return {
    smallWorkItemUpdates: small.status === 'fulfilled' ? small.value : -1,
    largeWorkItemUpdates: large.status === 'fulfilled' ? large.value : -1,
    workItemScheduler: scheduler.status === 'fulfilled' ? scheduler.value : -1,
  };
}

/**
 * Transforms raw metrics into the format expected by the Mustache template
 * and renders the HTML response.
 *
 * @param res - The Express response object
 * @param services - The map of service names to their queued counts
 * @param queues - The map of system queue names to their message counts
 * @param version - The version string to display on the dashboard in the footer
 *        (harmony version not the dashboard API version)
 */
function renderDashboardHtml(
  res: Response,
  services: Record<string, ServiceMetric>,
  queues: DashboardQueues,
  version: string,
): void {
  const servicesArray = Object.entries(services).map(([name, details]) => ({
    name,
    queued: details.queued,
  }));

  const queuesArray = Object.entries(queues).map(([name, count]) => ({
    name: camelCaseToSpacedTitleCase(name),
    count,
    isFailed: count === -1,
  }));

  // Sort by queued count descending for the primary dashboard view
  servicesArray.sort((a, b) => b.queued - a.queued);

  res.render('dashboard', {
    version,
    services: servicesArray,
    queues: queuesArray,
  });
}

/**
 * Express.js handler that returns the harmony dashboard responding with JSON by default
 * or HTML if requested.
 *
 * @param req - The Harmony request object
 * @param res - The Express response object
 * @param next - The Express next function
 * @throws RequestValidationError if the version is not supported
 */
export async function getDashboard(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const query = keysToLowerCase(req.query);
  const version = (query?.version as string);
  const versionText = version ? version : 'unspecified';

  try {
    if (version !== undefined) {
      validateVersion(version);
    }

    req.context.logger.info(`Dashboard requested by user ${req.user}, version: ${versionText}`);

    const [serviceMetrics, queueMetrics] = await Promise.all([
      getServiceMetrics(db),
      getSystemQueueMetrics(),
    ]);

    const result = {
      services: serviceMetrics,
      queues: queueMetrics,
      version: version || currentApiVersion,
    };

    // Default to JSON unless caller explicitly requests html
    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (acceptsHtml) {
      renderDashboardHtml(res, result.services, result.queues, harmonyVersion);
    } else {
      res.json(result);
    }

  } catch (e) {
    next(e);
  }
}
