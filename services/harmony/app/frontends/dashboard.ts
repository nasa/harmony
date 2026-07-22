import { NextFunction, Response } from 'express';
import { Knex } from 'knex';

import { camelCaseToSpacedTitleCase, listToText } from '@harmony/util/string';

import HarmonyRequest from '../models/harmony-request';
import { getCountsByService } from '../models/user-work';
import { getWorkItemsStatsSummary, WorkItemsStatsTimeWindow } from '../models/work-items-stats';
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

interface ServiceMetric {
  queued: number;
  windows: Record<string, StatusCounts>;
}

interface ServiceMetricsResult {
  services: Record<string, ServiceMetric>;
  timeRanges: Record<string, TimeRange>;
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
    windows: {},
  };

  for (const service of Object.values(services)) {
    totals.queued += service.queued;

    for (const [label, counts] of Object.entries(service.windows)) {
      totals.windows[label] ??= emptyStatusCounts();

      for (const status of TRACKED_STATUSES) {
        totals.windows[label][status] += counts[status];
      }
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
 * Throws an error if the requested time windows are invalid.
 *
 * @param windows - the requested dashboard time windows
 * @throws RequestValidationError if any window is invalid
 */
function validateTimeWindows(
  windows: WorkItemsStatsTimeWindow[],
): void {
  const seenLabels = new Set<string>();
  windows.forEach((window) => {
    const windowName = window.label;
    if (seenLabels.has(windowName)) {
      throw new RequestValidationError(
        `${windowName}: duplicate window label; window1 and window2 must use different labels.`,
      );
    }
    seenLabels.add(windowName);

    const hasStart = window.start !== undefined;
    const hasEnd = window.end !== undefined;
    const hasLastMinutes = window.lastMinutes !== undefined;
    const windowParameter = `window${window.index}`;

    if (hasStart && hasLastMinutes) {
      throw new RequestValidationError(
        `${windowParameter}: start and lastMinutes are mutually exclusive.`,
      );
    }

    if (!hasStart && !hasLastMinutes) {
      throw new RequestValidationError(
        `${windowParameter}: either start or lastMinutes must be provided.`,
      );
    }

    if (hasStart && hasEnd && window.start >= window.end) {
      throw new RequestValidationError(
        `${windowParameter}: start must be earlier than end.`,
      );
    }
  });
}

/**
 * Parses a string into an ISO-8601 date.
 *
 * @param value - the string to parse
 * @param name - the name of the parameter being parsed
 * @returns the parsed date
 */
function parseIsoDate(
  value: string,
  name: string,
): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RequestValidationError(
      `${name} must be a valid ISO-8601 timestamp.`,
    );
  }

  return date;
}

/**
 * Parses a string into a positive integer.
 *
 * @param value - the string to parse
 * @param name - the name of the parameter being parsed
 * @returns the parsed integer
 */
function parsePositiveInteger(
  value: string,
  name: string,
  max: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new RequestValidationError(
      `${name} must be a positive integer.`,
    );
  }

  const parsed = Number(value);

  if (parsed <= 0) {
    throw new RequestValidationError(
      `${name} must be greater than zero.`,
    );
  }
  if (max !== undefined && parsed > max) {
    throw new RequestValidationError(
      `${name} must be less than or equal to ${max}.`,
    );
  }
  return parsed;
}

export const THIRTY_YEARS_IN_MINUTES = 30 * 365 * 24 * 60;

/**
 * Parses and validates time window parameters from the query string.
 * @param query - The query string parameters from the request
 * @returns An array of WorkItemsStatsTimeWindow objects representing the requested time windows
 */
function parseTimeWindows(
  query: Record<string, unknown>,
): WorkItemsStatsTimeWindow[] {
  const windows: WorkItemsStatsTimeWindow[] = [];

  for (const i of [1, 2]) {
    const prefix = `window${i}.`;

    const label = query[`${prefix}label`] as string | undefined;
    const startText = query[`${prefix}start`] as string | undefined;
    const endText = query[`${prefix}end`] as string | undefined;
    const lastMinutesText = query[`${prefix}lastminutes`] as string | undefined;

    if (label !== undefined && label.trim().length === 0) {
      throw new RequestValidationError(
        `window${i}: label may not be empty.`,
      );
    }

    if (!label && !startText && !endText && !lastMinutesText) {
      continue;
    }

    const start = startText === undefined
      ? undefined
      : parseIsoDate(startText, `${prefix}start`);

    const end = endText === undefined
      ? undefined
      : parseIsoDate(endText, `${prefix}end`);

    const lastMinutes = lastMinutesText === undefined
      ? undefined
      : parsePositiveInteger(lastMinutesText, `${prefix}lastMinutes`, THIRTY_YEARS_IN_MINUTES);

    windows.push({
      label: label || `window${i}`,
      index: i,
      start,
      end,
      lastMinutes,
    });
  }

  return windows;
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

/**
 * Fetches and merges service work counts from the database, mapping image names
 * to service names and ensuring all known services are included. Includes recent
 * completion stats for the requested time windows (or the default last 5 and
 * last 60 full minutes if none are provided), along with the time ranges those
 * windows correspond to.
 *
 * @param dbConn - The database connection object
 * @param timeWindows - Time windows to retrieve statistics for. Defaults to the
 *   last 5 and last 60 full minutes if omitted or empty.
 * @returns Service metrics and the time ranges used for the requested windows
 */
async function getServiceMetrics(
  dbConn: Knex,
  timeWindows: WorkItemsStatsTimeWindow[] = [],
): Promise<ServiceMetricsResult> {
  const imageToServiceMap = getImageToServiceMap();

  const windows = timeWindows.length > 0
    ? timeWindows
    : [
      { label: 'last5Minutes', lastMinutes: 5 },
      { label: 'last60Minutes', lastMinutes: 60 },
    ];

  const [serviceWorkCounts, ...summaries] = await Promise.all([
    getCountsByService(dbConn),
    ...windows.map((window) =>
      dbConn.transaction((trx) => getWorkItemsStatsSummary(trx, window)),
    ),
  ]);

  const recentByWindow = summaries.map((summary) =>
    aggregateStatsByService(summary.rows, imageToServiceMap),
  );

  const queuedByService: Record<string, number> = {};
  for (const [image, value] of Object.entries(serviceWorkCounts)) {
    const service = getServiceName(imageToServiceMap, image);
    queuedByService[service] =
      (queuedByService[service] ?? 0) + (value as { queued: number }).queued;
  }

  const allServices = new Set<string>([
    ...Object.values(imageToServiceMap),
    ...Object.keys(queuedByService),
    ...recentByWindow.flatMap((stats) => Object.keys(stats)),
  ]);

  const merged: Record<string, ServiceMetric> = {};

  for (const service of allServices) {
    const serviceWindows: Record<string, StatusCounts> = {};

    windows.forEach((window, index) => {
      serviceWindows[window.label] =
        recentByWindow[index][service] ?? emptyStatusCounts();
    });

    merged[service] = {
      queued: queuedByService[service] ?? 0,
      windows: serviceWindows,
    };
  }

  const sortedServices = Object.keys(merged)
    .sort()
    .reduce(
      (acc, key) => ({
        ...acc,
        [key]: merged[key],
      }),
      {} as Record<string, ServiceMetric>,
    );

  const timeRanges = Object.fromEntries(
    summaries.map((summary, index) => [
      windows[index].label,
      {
        start: summary.start.toISOString(),
        end: summary.end.toISOString(),
      },
    ]),
  );

  return {
    services: sortedServices,
    timeRanges,
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

interface DashboardWindowView {
  label: string;
  displayName: string;
  startTime: string;
  endTime: string;

  successful: number;
  failed: number;
  canceled: number;
  warning: number;

  successfulClass: string;
  failedClass: string;
  canceledClass: string;
  warningClass: string;

  rate: string;
  rateClass: string;

  trendIsUp?: boolean;
  trendIsDown?: boolean;

  columnStart: number;
}

/**
 * Formats an ISO timestamp as a local-time HH:MM string.
 *
 * @param isoString - ISO timestamp
 * @param options - Intl.DateTimeFormatOptions to control formatting
 * @returns formatted local time
 */
function formatLocalTime(
  isoString: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat([], options).format(new Date(isoString));
}

/**
 * Returns Intl.DateTimeFormatOptions appropriate for the given time range.
 *
 * @param startIso - The start of the time range (ISO string)
 * @param endIso - The end of the time range (ISO string)
 * @returns Intl.DateTimeFormatOptions for formatting the time range
 */
function getTimeRangeFormatOptions(
  startIso: string,
  endIso: string,
): Intl.DateTimeFormatOptions {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const now = new Date();

  const sameDay = start.getFullYear() === now.getFullYear()
    && start.getMonth() === now.getMonth()
    && start.getDate() === now.getDate()
    && end.getFullYear() === now.getFullYear()
    && end.getMonth() === now.getMonth()
    && end.getDate() === now.getDate();

  if (sameDay) {
    return {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
  }

  const sameYear = start.getFullYear() === now.getFullYear()
    && end.getFullYear() === now.getFullYear();

  if (sameYear) {
    return {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
  }

  return {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
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
  const buildWindowView = (
    label: string,
    counts: StatusCounts,
    windowIndex: number,
  ): DashboardWindowView => {
    const rate = computeRate(counts);
    const range = timeRanges[label];
    const options = range
      ? getTimeRangeFormatOptions(range.start, range.end)
      : undefined;

    return {
      label,
      displayName: camelCaseToSpacedTitleCase(label),
      startTime: range ? formatLocalTime(range.start, options) : '',
      endTime: range ? formatLocalTime(range.end, options) : '',

      successful: counts.successful,
      failed: counts.failed,
      canceled: counts.canceled,
      warning: counts.warning,

      successfulClass: countClass(counts.successful, 'successful'),
      failedClass: countClass(counts.failed, 'failed'),
      canceledClass: countClass(counts.canceled, 'canceled'),
      warningClass: countClass(counts.warning, 'warning'),

      rate: formatRate(rate),
      rateClass: rateClass(rate),
      columnStart: 2 + (windowIndex * 5),
    };
  };

  const buildWindows = (
    windows: Record<string, StatusCounts>,
  ): DashboardWindowView[] => Object.entries(windows).map(
    ([label, counts], index): DashboardWindowView =>
      buildWindowView(label, counts, index),
  );

  const servicesArray = Object.entries(services).map(([name, details]) => {
    const windows = buildWindows(details.windows);

    let trendIsUp = false;
    let trendIsDown = false;

    const windowEntries = Object.entries(details.windows);

    if (windowEntries.length >= 2) {
      const currentRate = computeRate(windowEntries[0][1]);
      const baselineRate = computeRate(windowEntries[1][1]);

      if (currentRate !== null && baselineRate !== null) {
        const delta = currentRate - baselineRate;

        if (delta < -0.02) {
          trendIsDown = true;
        } else if (delta > 0.02) {
          trendIsUp = true;
        }
      }
    }

    const isIdle = details.queued === 0
      && Object.values(details.windows)
        .every((counts) => totalCounts(counts) === 0);

    return {
      name,
      queued: details.queued,
      windows,
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

  const windows = buildWindows(totals.windows);
  const summary = {
    queued: totals.queued,
    windows,
  };

  res.render('dashboard', {
    version,
    services: servicesArray,
    queues: queuesArray,
    timeRanges,
    summary,
    windows,
    windowCount: windows.length,
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
  const version = query.version as string | undefined;
  const versionText = version ?? 'unspecified';

  try {
    if (version !== undefined) {
      validateVersion(version);
    }

    const windows = parseTimeWindows(query);

    validateTimeWindows(windows);

    req.context.logger.info(
      `Dashboard requested by user ${req.user}, version: ${versionText}, windows requested: ${JSON.stringify(windows)}`,
    );

    const [{ services, timeRanges }, queueMetrics] = await Promise.all([
      getServiceMetrics(db, windows),
      getSystemQueueMetrics(),
    ]);

    const totals = getSystemTotals(services);

    const result = {
      timeRanges,
      queues: queueMetrics,
      totals,
      services,
      version: version ?? currentApiVersion,
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
