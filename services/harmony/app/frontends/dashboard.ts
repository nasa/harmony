import { NextFunction, Response } from 'express';
import { Knex } from 'knex';

import { camelCaseToSpacedTitleCase, listToText } from '@harmony/util/string';

import HarmonyRequest from '../models/harmony-request';
import { getCountsByService } from '../models/user-work';
import { getWorkItemsStatsSummary } from '../models/work-items-stats';
import db from '../util/db';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';
import { WorkItemQueueType } from '../util/queue/queue';
import { getQueueForType, getWorkSchedulerQueue } from '../util/queue/queue-factory';
import { getImageToServiceMap, getServiceName } from '../util/service-images';
import harmonyVersion from '../util/version';

export const currentApiVersion = '1-alpha';
const supportedApiVersions = ['1-alpha'];

const TRACKED_STATUSES = ['successful', 'failed', 'canceled', 'warning'] as const;
type TrackedStatus = typeof TRACKED_STATUSES[number];

type StatusCounts = Record<TrackedStatus, number>;

interface RecentMetrics {
  last5Minutes: StatusCounts;
  last60Minutes: StatusCounts;
}

interface ServiceMetric {
  queued: number;
  recent: RecentMetrics;
}

interface TimeRange {
  start: string;
  end: string;
}

interface DashboardQueues {
  smallWorkItemUpdates: number;
  largeWorkItemUpdates: number;
  workItemScheduler: number;
}

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

/**
 * Returns a fresh StatusCounts object with all tracked statuses initialized to 0.
 */
function emptyStatusCounts(): StatusCounts {
  return TRACKED_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as StatusCounts);
}

/**
 * Folds rows from getWorkItemStatsSummary into a map of service to StatusCounts,
 * mapping image names to service names along the way.
 *
 * @param rows - the rows returned from getWorkItemStatsSummary
 * @param imageToServiceMap - mapping from container image to service name
 * @returns map of service name to StatusCounts
 */
function aggregateStatsByService(
  rows: { service_id: string; status: string; count: number }[],
  imageToServiceMap: Record<string, string>,
): Record<string, StatusCounts> {
  const result: Record<string, StatusCounts> = {};

  for (const row of rows) {
    if (!TRACKED_STATUSES.includes(row.status as TrackedStatus)) {
      continue;
    }
    const status = row.status as TrackedStatus;
    const service = getServiceName(imageToServiceMap, row.service_id);
    if (!result[service]) {
      result[service] = emptyStatusCounts();
    }
    result[service][status] += row.count;
  }

  return result;
}

interface ServiceMetricsResult {
  services: Record<string, ServiceMetric>;
  timeRanges: Record<string, TimeRange>;
}

/**
 * Fetches and merges service work counts from the database, mapping image names
 * to service names and ensuring all known services are included. Includes recent
 * completion stats over the last 5 and 60 full minutes (excluding the in-progress
 * current minute), along with the time ranges those windows correspond to.
 *
 * @param dbConn - The database connection object
 * @returns Service metrics and the time ranges used for the recent stats windows
 */
async function getServiceMetrics(dbConn: Knex): Promise<ServiceMetricsResult> {
  const imageToServiceMap = getImageToServiceMap();

  const [serviceWorkCounts, last5MinutesSummary, last60MinutesSummary] = await Promise.all([
    getCountsByService(dbConn),
    dbConn.transaction((trx) => getWorkItemsStatsSummary(trx, 5)),
    dbConn.transaction((trx) => getWorkItemsStatsSummary(trx, 60)),
  ]);

  const last5ByService = aggregateStatsByService(last5MinutesSummary.rows, imageToServiceMap);
  const last60ByService = aggregateStatsByService(last60MinutesSummary.rows, imageToServiceMap);

  const queuedByService: Record<string, number> = {};
  for (const [image, value] of Object.entries(serviceWorkCounts)) {
    const service = getServiceName(imageToServiceMap, image);
    queuedByService[service] = (queuedByService[service] ?? 0)
      + (value as { queued: number }).queued;
  }

  const allServices = new Set<string>([
    ...Object.values(imageToServiceMap),
    ...Object.keys(queuedByService),
    ...Object.keys(last5ByService),
    ...Object.keys(last60ByService),
  ]);

  const merged: Record<string, ServiceMetric> = {};
  for (const service of allServices) {
    merged[service] = {
      queued: queuedByService[service] ?? 0,
      recent: {
        last5Minutes: last5ByService[service] ?? emptyStatusCounts(),
        last60Minutes: last60ByService[service] ?? emptyStatusCounts(),
      },
    };
  }

  const sortedServices = Object.keys(merged).sort().reduce((acc, key) => ({
    ...acc,
    [key]: merged[key],
  }), {} as Record<string, ServiceMetric>);

  return {
    services: sortedServices,
    timeRanges: {
      last5Minutes: {
        start: last5MinutesSummary.start.toISOString(),
        end: last5MinutesSummary.end.toISOString(),
      },
      last60Minutes: {
        start: last60MinutesSummary.start.toISOString(),
        end: last60MinutesSummary.end.toISOString(),
      },
    },
  };
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
 * @param services - The map of service names to their metrics
 * @param queues - The map of system queue names to their message counts
 * @param timeRanges - The map of time range names to their start/end boundaries
 * @param version - The version string to display on the dashboard in the footer
 *        (harmony version not the dashboard API version)
 */
function renderDashboardHtml(
  res: Response,
  services: Record<string, ServiceMetric>,
  queues: DashboardQueues,
  timeRanges: Record<string, TimeRange>,
  version: string,
): void {
  const countClass = (count: number, status: TrackedStatus): string => {
    if (count === 0) return 'count-zero';
    return `count-${status}`;
  };

  const computeRate = (c: StatusCounts): number | null => {
    const denom = c.successful + c.failed + c.warning;
    if (denom === 0) return null;
    return c.successful / denom;
  };

  const rateClass = (r: number | null): string => {
    if (r === null) return 'rate-na';
    if (r >= 0.99) return 'rate-good';
    if (r >= 0.95) return 'rate-warn';
    return 'rate-bad';
  };

  const formatRate = (r: number | null): string =>
    r === null ? '—' : `${(r * 100).toFixed(1)}%`;

  const totalCounts = (c: StatusCounts): number =>
    c.successful + c.failed + c.canceled + c.warning;

  const servicesArray = Object.entries(services).map(([name, details]) => {
    const rate5 = computeRate(details.recent.last5Minutes);
    const rate60 = computeRate(details.recent.last60Minutes);

    // Trend: compare 5-min rate to 60-min rate. A drop in success rate
    // from the 60-min baseline is a "things got worse" signal.
    let trendIsUp = false;
    let trendIsDown = false;
    if (rate5 !== null && rate60 !== null) {
      const delta = rate5 - rate60;
      if (delta < -0.02) trendIsDown = true;       // 5-min worse than 60-min
      else if (delta > 0.02) trendIsUp = true;     // 5-min better than 60-min
    }

    const isIdle = details.queued === 0
      && totalCounts(details.recent.last5Minutes) === 0
      && totalCounts(details.recent.last60Minutes) === 0;

    return {
      name,
      queued: details.queued,
      last5: {
        successful: details.recent.last5Minutes.successful,
        failed: details.recent.last5Minutes.failed,
        canceled: details.recent.last5Minutes.canceled,
        warning: details.recent.last5Minutes.warning,
        successfulClass: countClass(details.recent.last5Minutes.successful, 'successful'),
        failedClass: countClass(details.recent.last5Minutes.failed, 'failed'),
        canceledClass: countClass(details.recent.last5Minutes.canceled, 'canceled'),
        warningClass: countClass(details.recent.last5Minutes.warning, 'warning'),
      },
      last60: {
        successful: details.recent.last60Minutes.successful,
        failed: details.recent.last60Minutes.failed,
        canceled: details.recent.last60Minutes.canceled,
        warning: details.recent.last60Minutes.warning,
        successfulClass: countClass(details.recent.last60Minutes.successful, 'successful'),
        failedClass: countClass(details.recent.last60Minutes.failed, 'failed'),
        canceledClass: countClass(details.recent.last60Minutes.canceled, 'canceled'),
        warningClass: countClass(details.recent.last60Minutes.warning, 'warning'),
      },
      rate5: formatRate(rate5),
      rate5Class: rateClass(rate5),
      rate60: formatRate(rate60),
      rate60Class: rateClass(rate60),
      trendIsUp,
      trendIsDown,
      isIdle,
    };
  });

  const queuesArray = Object.entries(queues).map(([name, count]) => ({
    name: camelCaseToSpacedTitleCase(name),
    count,
    isFailed: count === -1,
  }));

  // Sort by queued count descending for the primary dashboard view
  servicesArray.sort((a, b) => b.queued - a.queued);

  const totals = servicesArray.reduce((acc, s) => {
    acc.queued += s.queued;
    acc.last5.successful += s.last5.successful;
    acc.last5.failed += s.last5.failed;
    acc.last5.canceled += s.last5.canceled;
    acc.last5.warning += s.last5.warning;
    acc.last60.successful += s.last60.successful;
    acc.last60.failed += s.last60.failed;
    acc.last60.canceled += s.last60.canceled;
    acc.last60.warning += s.last60.warning;
    return acc;
  }, {
    queued: 0,
    last5: { successful: 0, failed: 0, canceled: 0, warning: 0 },
    last60: { successful: 0, failed: 0, canceled: 0, warning: 0 },
  });

  const totalsRate5 = computeRate(totals.last5);
  const totalsRate60 = computeRate(totals.last60);

  const summary = {
    queued: totals.queued,
    last5: {
      successful: totals.last5.successful,
      failed: totals.last5.failed,
      canceled: totals.last5.canceled,
      warning: totals.last5.warning,
      successfulClass: countClass(totals.last5.successful, 'successful'),
      failedClass: countClass(totals.last5.failed, 'failed'),
      canceledClass: countClass(totals.last5.canceled, 'canceled'),
      warningClass: countClass(totals.last5.warning, 'warning'),
    },
    last60: {
      successful: totals.last60.successful,
      failed: totals.last60.failed,
      canceled: totals.last60.canceled,
      warning: totals.last60.warning,
      successfulClass: countClass(totals.last60.successful, 'successful'),
      failedClass: countClass(totals.last60.failed, 'failed'),
      canceledClass: countClass(totals.last60.canceled, 'canceled'),
      warningClass: countClass(totals.last60.warning, 'warning'),
    },
    rate5: formatRate(totalsRate5),
    rate5Class: rateClass(totalsRate5),
    rate60: formatRate(totalsRate60),
    rate60Class: rateClass(totalsRate60),
  };

  res.render('dashboard', {
    version,
    services: servicesArray,
    queues: queuesArray,
    timeRanges,
    summary,
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

    const [{ services, timeRanges }, queueMetrics] = await Promise.all([
      getServiceMetrics(db),
      getSystemQueueMetrics(),
    ]);

    const result = {
      timeRanges,
      services,
      queues: queueMetrics,
      version: version || currentApiVersion,
    };

    // Default to JSON unless caller explicitly requests html
    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (acceptsHtml) {
      renderDashboardHtml(res, result.services, result.queues, result.timeRanges, harmonyVersion);
    } else {
      res.json(result);
    }

  } catch (e) {
    next(e);
  }
}
