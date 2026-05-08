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
 * Returns a fresh StatusCounts object with all tracked statuses initialized to 0.
 */
function emptyStatusCounts(): StatusCounts {
  return TRACKED_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as StatusCounts);
}

/**
 * Returns combined metric information summing across all services in the system
 *
 * @param services - the services metrics
 * @returns a summary of the service information combined across all services
 */
function getSystemTotals(
  services: Record<string, ServiceMetric>,
): ServiceMetric {
  const totals: ServiceMetric = {
    queued: 0,
    recent: {
      last5Minutes: emptyStatusCounts(),
      last60Minutes: emptyStatusCounts(),
    },
  };

  for (const service of Object.values(services)) {
    totals.queued += service.queued;

    for (const status of TRACKED_STATUSES) {
      totals.recent.last5Minutes[status] += service.recent.last5Minutes[status];
      totals.recent.last60Minutes[status] += service.recent.last60Minutes[status];
    }
  }

  return totals;
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
 * Returns the CSS class used to style a count cell for a given status.
 *
 * @param count - The numeric count for the status
 * @param status - The tracked status type
 * @returns CSS class name for the count cell
 */
function countClass(count: number, status: TrackedStatus): string {
  if (count === 0) {
    return 'count-zero';
  }

  return `count-${status}`;
}

/**
 * Computes a success rate from a set of status counts.
 * Warnings are included in the denominator while canceled items are excluded.
 *
 * @param counts - The status counts to evaluate
 * @returns Success rate between 0 and 1, or null if no applicable items exist
 */
function computeRate(counts: StatusCounts): number | null {
  const denominator = counts.successful + counts.failed + counts.warning;

  if (denominator === 0) {
    return null;
  }

  return counts.successful / denominator;
}

/**
 * Returns the CSS class used to style a success rate value.
 *
 * @param rate - The computed success rate or null if unavailable
 * @returns CSS class name for the rate display
 */
function rateClass(rate: number | null): string {
  if (rate === null) {
    return 'rate-na';
  }

  if (rate >= 0.99) {
    return 'rate-good';
  }

  if (rate >= 0.95) {
    return 'rate-warn';
  }

  return 'rate-bad';
}

/**
 * Formats a success rate for display in the dashboard.
 *
 * @param rate - The computed success rate or null if unavailable
 * @returns Formatted percentage string or em dash if unavailable
 */
function formatRate(rate: number | null): string {
  if (rate === null) {
    return '—';
  }

  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Computes the total number of tracked work items across all statuses.
 *
 * @param counts - The status counts to total
 * @returns Sum of all tracked statuses
 */
function totalCounts(counts: StatusCounts): number {
  return counts.successful
    + counts.failed
    + counts.canceled
    + counts.warning;
}

/**
 * Transforms raw metrics into the format expected by the Mustache template
 * and renders the HTML response.
 *
 * @param res - The Express response object
 * @param services - The map of service names to their metrics
 * @param queues - The map of system queue names to their message counts
 * @param timeRanges - The map of time range names to their start/end boundaries
 * @param totals - The aggregated metrics combined across all of the services
 * @param version - The version string to display on the dashboard in the footer
 *        (harmony version not the dashboard API version)
 */
function renderDashboardHtml(
  res: Response,
  services: Record<string, ServiceMetric>,
  queues: DashboardQueues,
  timeRanges: Record<string, TimeRange>,
  totals: ServiceMetric,
  version: string,
): void {
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

  const totalsRate5 = computeRate(totals.recent.last5Minutes);
  const totalsRate60 = computeRate(totals.recent.last60Minutes);

  const summary = {
    queued: totals.queued,
    last5: {
      successful: totals.recent.last5Minutes.successful,
      failed: totals.recent.last5Minutes.failed,
      canceled: totals.recent.last5Minutes.canceled,
      warning: totals.recent.last5Minutes.warning,
      successfulClass: countClass(totals.recent.last5Minutes.successful, 'successful'),
      failedClass: countClass(totals.recent.last5Minutes.failed, 'failed'),
      canceledClass: countClass(totals.recent.last5Minutes.canceled, 'canceled'),
      warningClass: countClass(totals.recent.last5Minutes.warning, 'warning'),
    },
    last60: {
      successful: totals.recent.last60Minutes.successful,
      failed: totals.recent.last60Minutes.failed,
      canceled: totals.recent.last60Minutes.canceled,
      warning: totals.recent.last60Minutes.warning,
      successfulClass: countClass(totals.recent.last60Minutes.successful, 'successful'),
      failedClass: countClass(totals.recent.last60Minutes.failed, 'failed'),
      canceledClass: countClass(totals.recent.last60Minutes.canceled, 'canceled'),
      warningClass: countClass(totals.recent.last60Minutes.warning, 'warning'),
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

    const totals = getSystemTotals(services);

    const result = {
      timeRanges,
      queues: queueMetrics,
      totals,
      services,
      version: version || currentApiVersion,
    };

    // Default to JSON unless caller explicitly requests html
    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (acceptsHtml) {
      renderDashboardHtml(res, result.services, result.queues, result.timeRanges, result.totals, harmonyVersion);
    } else {
      res.json(result);
    }

  } catch (e) {
    next(e);
  }
}
