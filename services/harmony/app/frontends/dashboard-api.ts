import { NextFunction, Response } from 'express';
import { LRUCache } from 'lru-cache';

import { DashboardQueues, getSystemQueueMetrics } from './dashboard';
import {
  bucketCount, estimatePercentile, getFailureCategories, getJobsWithWorkItemStatus, getJobTotals,
  getLongestRunningJobs, getServiceIdsInRange, getServiceSeries, getServiceTotals, getStatsLastUpdated, getStatusSeries,
  getUserSeries, getUserTotals, JobTotals, MAX_SPARKLINE_BUCKETS, previousRange, resolveRange,
  StatsRange, withMaxBuckets, WorkItemMetrics,
} from '../models/dashboard-stats';
import HarmonyRequest from '../models/harmony-request';
import { getLiveWork, LiveWork, LiveWorkRow } from '../models/user-work';
import { DURATION_BUCKET_UPPER_BOUNDS_MS } from '../models/work-items-stats';
import db, { Transaction } from '../util/db';
import env from '../util/env';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';
import { getImageToServiceMap, getServiceName } from '../util/service-images';

// The JSON API behind the admin dashboard page (/admin/dashboard/api/*). Every response is built
// from the aggregate stats tables and user_work (see models/dashboard-stats.ts), runs in a read
// only transaction with a statement timeout, and is cached for DASHBOARD_CACHE_TTL_MS.

// The versions of the dashboard API's response formats. Like /admin/dashboard, requests may pin a
// version with the version query parameter, and get the current version if they don't. Add a
// version (and keep serving the old ones) when a response format changes incompatibly.
export const CURRENT_DASHBOARD_API_VERSION = '1';
const SUPPORTED_DASHBOARD_API_VERSIONS = ['1'];

const DEFAULT_RANGE = '24h';
const STATUSES = ['successful', 'failed', 'canceled', 'warning'] as const;
type Status = typeof STATUSES[number];
type StatusCounts = Record<Status, number>;

const DEFAULT_USER_LIMIT = 25;
const MAX_USER_LIMIT = 500;
const MAX_DETAIL_USERS = 25;
const MAX_FAILURE_CATEGORIES = 15;
const DEFAULT_RUNNING_JOBS_LIMIT = 10;
const MAX_RUNNING_JOBS_LIMIT = 100;
const DEFAULT_STATUS_JOBS_LIMIT = 25;
const MAX_STATUS_JOBS_LIMIT = 100;
// running jobs that haven't been updated for this long are counted as stalled
const STALLED_JOB_MS = 60 * 60 * 1000;

// A work item summary for a range, for any grouping (the whole system, a service, a user, ...)
interface WorkItemSummary {
  counts: StatusCounts;
  total: number;
  // successful / (successful + failed) - canceled and warning work items don't count either way
  successRate: number | null;
  throughputPerMinute: number;
  avgDurationMs: number | null;
  // only available for service level stats, which have duration histograms
  p50DurationMs?: number | null;
  p95DurationMs?: number | null;
  maxDurationMs: number | null;
  // the summed duration of every work item with a duration - a proxy for the compute time used
  computeMs: number;
  // retry attempts by every work item, including failed ones that used up their retries
  retries: number;
  // retry attempts by work items that went on to succeed, and the share of those work items'
  // attempts that were retries - the same measures as /admin/retry-stats
  successfulRetries: number;
  successfulRetryRate: number | null;
  itemsSizeMb: number;
}

// Live work as returned by the API
interface LiveWorkSummary {
  ready: number;
  running: number;
  oldestReadyWaitMs: number | null;
}

// A finished job summary for a range
interface JobSummary {
  counts: Record<string, number>;
  total: number;
  sync: { count: number, avgDurationMs: number | null, maxDurationMs: number | null };
  async: { count: number, avgDurationMs: number | null, maxDurationMs: number | null };
  granules: number;
  inputSizeMb: number;
  outputSizeMb: number;
}

// Response caching, keyed by endpoint and query parameters. The promise is cached, so concurrent
// requests for the same data share a single set of queries.
let cache: LRUCache<string, Promise<unknown>> | undefined;

/**
 * Clears the response cache (for tests)
 */
export function clearDashboardCache(): void {
  cache?.clear();
}

/**
 * Gets a cached response, or builds and caches it
 *
 * @param key - the cache key
 * @param build - builds the response
 * @returns the response
 */
async function cached<T>(key: string, build: () => Promise<T>): Promise<T> {
  if (env.dashboardCacheTtlMs <= 0) {
    return build();
  }
  cache ??= new LRUCache({ max: 200, ttl: env.dashboardCacheTtlMs });
  let result = cache.get(key) as Promise<T> | undefined;
  if (!result) {
    result = build();
    cache.set(key, result);
    // never cache failures
    result.catch(() => cache.delete(key));
  }
  return result;
}

/**
 * Runs the queries for a dashboard response in a read only transaction, with a statement timeout
 * on Postgres so a slow dashboard query can never tie up the database
 *
 * @param fn - runs the queries
 * @returns the result of fn
 */
async function readOnly<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    if (trx.client.config.client === 'pg') {
      await trx.raw('SET TRANSACTION READ ONLY');
      await trx.raw(`SET LOCAL statement_timeout = ${Math.floor(env.dashboardQueryTimeoutMs)}`);
    }
    return fn(trx);
  });
}

/**
 * Parses an ISO-8601 timestamp query parameter
 *
 * @param value - the parameter value
 * @param name - the parameter name
 * @returns the date
 * @throws RequestValidationError if the value isn't a valid timestamp
 */
function parseTimestamp(value: unknown, name: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new RequestValidationError(`${name} must be a valid ISO-8601 timestamp.`);
  }
  return date;
}

/**
 * Parses the range query parameters: either range (a preset like 24h, the default) or start and end
 *
 * @param query - the query parameters, with lower cased keys
 * @param now - the current time
 * @returns the resolved range
 * @throws RequestValidationError if the parameters are invalid
 */
function parseRange(query: Record<string, unknown>, now: Date): StatsRange {
  if (query.start !== undefined || query.end !== undefined) {
    if (query.range !== undefined) {
      throw new RequestValidationError('range and start/end are mutually exclusive.');
    }
    return resolveRange({
      start: parseTimestamp(query.start, 'start'),
      end: query.end === undefined ? now : parseTimestamp(query.end, 'end'),
    }, now, env.workItemsStatsMinuteRetentionDays);
  }
  return resolveRange(
    { preset: String(query.range ?? DEFAULT_RANGE) }, now, env.workItemsStatsMinuteRetentionDays);
}

/**
 * Parses a positive integer limit query parameter
 *
 * @param value - the parameter value
 * @param defaultValue - the value to use if the parameter wasn't given
 * @param max - the maximum allowed value
 * @returns the limit
 * @throws RequestValidationError if the value isn't a positive integer of at most max
 */
function parseLimit(value: unknown, defaultValue: number, max: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new RequestValidationError(`limit must be an integer from 1 to ${max}.`);
  }
  return limit;
}

/**
 * Gets the dashboard API version a request asks for
 *
 * @param value - the version query parameter
 * @returns the version, or the current version if none was given
 * @throws RequestValidationError if the version is not supported
 */
function parseVersion(value: unknown): string {
  if (value === undefined) {
    return CURRENT_DASHBOARD_API_VERSION;
  }
  const version = String(value).toLowerCase();
  if (!SUPPORTED_DASHBOARD_API_VERSIONS.includes(version)) {
    throw new RequestValidationError(
      `Invalid API version. Supported versions are: ${SUPPORTED_DASHBOARD_API_VERSIONS.join(', ')}`);
  }
  return version;
}

/**
 * Gets a cache key for a request's query parameters
 *
 * @param prefix - the endpoint
 * @param query - the query parameters, with lower cased keys
 * @returns the key
 */
function cacheKey(prefix: string, query: Record<string, unknown>): string {
  const params = Object.keys(query).sort().map((k) => `${k}=${String(query[k])}`);
  // the version is part of the key so that each version's responses are cached separately
  return `${prefix}?${params.join('&')}`;
}

/**
 * Serializes a range for a response
 *
 * @param range - the range
 * @returns the range as JSON
 */
function rangeJson(range: StatsRange): object {
  return {
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    granularity: range.granularity,
    bucketMs: range.bucketMs,
  };
}

/**
 * Gets how much of a range has already happened, used to compute rates: a preset range with hourly
 * granularity includes the rest of the current hour
 *
 * @param range - the range
 * @param now - the current time
 * @returns the elapsed length of the range in ms (at least a minute)
 */
function elapsedMs(range: StatsRange, now: Date): number {
  return Math.max(60_000, Math.min(range.end.getTime(), now.getTime()) - range.start.getTime());
}

/**
 * Returns zero counts for every status
 *
 * @returns the counts
 */
function emptyCounts(): StatusCounts {
  return { successful: 0, failed: 0, canceled: 0, warning: 0 };
}

/**
 * Computes a success rate. Canceled and warning work items count neither for nor against it.
 *
 * @param counts - the status counts
 * @returns the success rate between 0 and 1, or null if there were no successes or failures
 */
function successRate(counts: StatusCounts): number | null {
  const denominator = counts.successful + counts.failed;
  return denominator === 0 ? null : counts.successful / denominator;
}

// The combined metrics of a set of work item stats rows
interface AccumulatedMetrics {
  counts: StatusCounts;
  durationCount: number;
  sumDuration: number;
  maxDuration: number;
  retries: number;
  successfulRetries: number;
  itemsSize: number;
  // the combined duration histogram, if the rows have them
  buckets?: number[];
}

/**
 * Combines the metrics of work item stats rows
 *
 * @param rows - the rows, each for a single status
 * @returns the combined metrics
 */
function accumulateMetrics(rows: (WorkItemMetrics & { status: string })[]): AccumulatedMetrics {
  const result: AccumulatedMetrics = {
    counts: emptyCounts(), durationCount: 0, sumDuration: 0, maxDuration: 0, retries: 0,
    successfulRetries: 0, itemsSize: 0,
  };
  for (const row of rows) {
    if ((STATUSES as readonly string[]).includes(row.status)) {
      result.counts[row.status as Status] += row.count;
    }
    result.durationCount += row.duration_count;
    result.sumDuration += row.sum_duration_ms;
    result.maxDuration = Math.max(result.maxDuration, row.max_duration_ms);
    result.retries += row.retry_count;
    if (row.status === 'successful') {
      result.successfulRetries += row.retry_count;
    }
    result.itemsSize += row.sum_items_size;
    if (row.buckets) {
      result.buckets ??= row.buckets.map(() => 0);
      for (let i = 0; i < row.buckets.length; i++) {
        result.buckets[i] += row.buckets[i];
      }
    }
  }
  return result;
}

/**
 * Summarizes aggregated work item stats rows
 *
 * @param rows - the rows, each for a single status
 * @param range - the range they are for
 * @param now - the current time
 * @returns the summary
 */
function summarizeWorkItems(
  rows: (WorkItemMetrics & { status: string })[], range: StatsRange, now: Date,
): WorkItemSummary {
  const m = accumulateMetrics(rows);
  const total = STATUSES.reduce((sum, s) => sum + m.counts[s], 0);
  const summary: WorkItemSummary = {
    counts: m.counts,
    total,
    successRate: successRate(m.counts),
    throughputPerMinute: total / (elapsedMs(range, now) / 60_000),
    avgDurationMs: m.durationCount > 0 ? Math.round(m.sumDuration / m.durationCount) : null,
    maxDurationMs: m.durationCount > 0 ? m.maxDuration : null,
    computeMs: m.sumDuration,
    retries: m.retries,
    successfulRetries: m.successfulRetries,
    // each successful work item was attempted once plus once per retry
    successfulRetryRate: m.counts.successful > 0
      ? m.successfulRetries / (m.counts.successful + m.successfulRetries) : null,
    itemsSizeMb: m.itemsSize,
  };
  if (m.buckets) {
    summary.p50DurationMs = estimatePercentile(m.buckets, m.maxDuration, 0.5);
    summary.p95DurationMs = estimatePercentile(m.buckets, m.maxDuration, 0.95);
  }
  return summary;
}

/**
 * Summarizes finished job stats rows
 *
 * @param rows - the rows
 * @returns the summary
 */
function summarizeJobs(rows: JobTotals[]): JobSummary {
  const counts: Record<string, number> = {
    successful: 0, complete_with_errors: 0, failed: 0, canceled: 0,
  };
  const modes = {
    sync: { count: 0, sum: 0, max: 0 },
    async: { count: 0, sum: 0, max: 0 },
  };
  let granules = 0;
  let inputSize = 0;
  let outputSize = 0;
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + row.count;
    const mode = row.is_async ? modes.async : modes.sync;
    mode.count += row.count;
    mode.sum += row.sum_duration_ms;
    mode.max = Math.max(mode.max, row.max_duration_ms);
    granules += row.sum_granules;
    inputSize += row.sum_input_size;
    outputSize += row.sum_output_size;
  }
  const modeSummary = (m: { count: number, sum: number, max: number }): JobSummary['sync'] => ({
    count: m.count,
    avgDurationMs: m.count > 0 ? Math.round(m.sum / m.count) : null,
    maxDurationMs: m.count > 0 ? m.max : null,
  });
  return {
    counts,
    total: modes.sync.count + modes.async.count,
    sync: modeSummary(modes.sync),
    async: modeSummary(modes.async),
    granules,
    inputSizeMb: inputSize,
    outputSizeMb: outputSize,
  };
}

/**
 * Combines live work rows
 *
 * @param rows - the rows
 * @param now - the current time
 * @returns the combined live work
 */
function summarizeLiveWork(rows: LiveWork[], now: Date): LiveWorkSummary {
  let ready = 0;
  let running = 0;
  let oldest: number | null = null;
  for (const row of rows) {
    ready += row.ready;
    running += row.running;
    if (row.oldestReadyLastWorked) {
      const t = row.oldestReadyLastWorked.getTime();
      oldest = oldest === null ? t : Math.min(oldest, t);
    }
  }
  return { ready, running, oldestReadyWaitMs: oldest === null ? null : Math.max(0, now.getTime() - oldest) };
}

/**
 * Groups rows by the service name of their service_id (an image)
 *
 * @param rows - the rows
 * @param imageToServiceMap - the map from images to service names
 * @returns the rows for each service name
 */
function groupByServiceName<T extends { service_id?: string }>(
  rows: T[], imageToServiceMap: Record<string, string>,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const name = getServiceName(imageToServiceMap, row.service_id);
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(row);
  }
  return groups;
}

/**
 * Groups rows by a key
 *
 * @param rows - the rows
 * @param keyOf - gets a row's key
 * @returns the rows for each key
 */
function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  return groups;
}

/**
 * Builds a time series of work item counts by status and duration stats for each bucket of a range
 *
 * @param rows - the per-bucket stats rows
 * @param range - the range
 * @returns the series
 */
function buildStatusSeries(
  rows: (WorkItemMetrics & { bucket: number, status: string })[], range: StatsRange,
): object[] {
  const byBucket = groupBy(rows, (r) => String(r.bucket));
  return Array.from({ length: bucketCount(range) }, (_, i) => {
    const m = accumulateMetrics(byBucket.get(String(i)) ?? []);
    return {
      t: new Date(range.start.getTime() + i * range.bucketMs).toISOString(),
      ...m.counts,
      computeMs: m.sumDuration,
      avgDurationMs: m.durationCount > 0 ? Math.round(m.sumDuration / m.durationCount) : null,
      p95DurationMs: m.buckets ? estimatePercentile(m.buckets, m.maxDuration, 0.95) : null,
    };
  });
}

/**
 * Builds the duration histogram of a set of service level stats rows
 *
 * @param rows - the rows
 * @returns each bucket's bounds and count
 */
function buildHistogram(rows: WorkItemMetrics[]): object[] {
  const counts = DURATION_BUCKET_UPPER_BOUNDS_MS.map(() => 0).concat([0]);
  for (const row of rows) {
    row.buckets?.forEach((b, i) => { counts[i] += b; });
  }
  return counts.map((count, i) => ({
    lowerMs: i === 0 ? 0 : DURATION_BUCKET_UPPER_BOUNDS_MS[i - 1],
    upperMs: DURATION_BUCKET_UPPER_BOUNDS_MS[i] ?? null,
    count,
  }));
}

/**
 * Gets a link to the admin workflow UI jobs listing filtered to a user
 *
 * @param username - the user
 * @returns the link
 */
function workflowUiLinkForUser(username: string): string {
  const filter = JSON.stringify([{ value: `user: ${username}`, dbValue: username, field: 'user' }]);
  return `/admin/workflow-ui?tableFilter=${encodeURIComponent(filter)}`;
}

/**
 * Gets the dashboard's overall summary: system wide work item totals with period over period
 * comparison, a time series, the duration histogram, each service's stats and live work, finished
 * job stats, system queue sizes, and how fresh the stats are.
 *
 * @param query - the query parameters, with lower cased keys
 * @returns the summary
 */
async function buildSummary(query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const range = parseRange(query, now);
  const previous = previousRange(range);
  const sparkRange = withMaxBuckets(range, MAX_SPARKLINE_BUCKETS);

  const [data, queues] = await Promise.all([
    readOnly(async (trx) => ({
      totals: await getServiceTotals(trx, range),
      previousTotals: await getServiceTotals(trx, previous),
      series: await getStatusSeries(trx, range),
      sparks: await getServiceSeries(trx, sparkRange),
      jobs: await getJobTotals(trx, range, false),
      previousJobs: await getJobTotals(trx, previous, false),
      live: await getLiveWork(trx, ['service_id']),
      lastUpdated: await getStatsLastUpdated(trx),
    })),
    getSystemQueueMetrics() as Promise<DashboardQueues>,
  ]);

  const imageToServiceMap = getImageToServiceMap();
  const totalsByService = groupByServiceName(data.totals, imageToServiceMap);
  const previousByService = groupByServiceName(data.previousTotals, imageToServiceMap);
  const sparksByService = groupByServiceName(data.sparks, imageToServiceMap);
  const liveByService = groupByServiceName(data.live, imageToServiceMap);
  const sparkBuckets = bucketCount(sparkRange);

  const names = new Set<string>([
    ...Object.values(imageToServiceMap), ...totalsByService.keys(), ...liveByService.keys(),
  ]);
  const services = [...names].map((name) => {
    const summary = summarizeWorkItems(totalsByService.get(name) ?? [], range, now);
    const live = summarizeLiveWork(liveByService.get(name) ?? [], now);
    const spark = Array.from({ length: sparkBuckets }, () => 0);
    const sparkFailed = Array.from({ length: sparkBuckets }, () => 0);
    for (const row of sparksByService.get(name) ?? []) {
      spark[row.bucket] += row.count;
      if (row.status === 'failed') {
        sparkFailed[row.bucket] += row.count;
      }
    }
    return {
      name,
      ...summary,
      previousSuccessRate: summarizeWorkItems(previousByService.get(name) ?? [], previous, now).successRate,
      previousTotal: summarizeWorkItems(previousByService.get(name) ?? [], previous, now).total,
      live,
      spark,
      sparkFailed,
      isIdle: summary.total === 0 && live.ready === 0 && live.running === 0,
    };
  }).sort((a, b) => (b.live.ready + b.live.running) - (a.live.ready + a.live.running)
    || b.total - a.total || a.name.localeCompare(b.name));

  const { lastUpdated } = data;
  return {
    generatedAt: now.toISOString(),
    statsLastUpdated: lastUpdated?.toISOString() ?? null,
    statsAgeMs: lastUpdated ? Math.max(0, now.getTime() - lastUpdated.getTime()) : null,
    range: rangeJson(range),
    previousRange: rangeJson(previous),
    sparkBucketMs: sparkRange.bucketMs,
    totals: summarizeWorkItems(data.totals, range, now),
    previousTotals: summarizeWorkItems(data.previousTotals, previous, now),
    live: summarizeLiveWork(data.live, now),
    series: buildStatusSeries(data.series, range),
    histogram: buildHistogram(data.totals),
    services,
    jobs: summarizeJobs(data.jobs),
    previousJobs: summarizeJobs(data.previousJobs),
    queues,
  };
}

/**
 * Gets the details of a service: its work item totals with period over period comparison, a time
 * series, its duration histogram, its stats by image (version), its failure message categories,
 * the users with the most work for it, and its live work by user.
 *
 * @param serviceName - the service name
 * @param query - the query parameters, with lower cased keys
 * @returns the details
 */
async function buildServiceDetails(serviceName: string, query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const range = parseRange(query, now);
  const previous = previousRange(range);
  const imageToServiceMap = getImageToServiceMap();
  const isService = (id: string): boolean => getServiceName(imageToServiceMap, id) === serviceName;

  const data = await readOnly(async (trx) => {
    const liveRows = (await getLiveWork(trx, ['service_id', 'username'])).filter((r) => isService(r.service_id));
    const ids = [...new Set([
      ...(await getServiceIdsInRange(trx, range)).filter(isService),
      ...(await getServiceIdsInRange(trx, previous)).filter(isService),
      ...liveRows.map((r) => r.service_id),
    ])];
    if (ids.length === 0) {
      return { liveRows, totals: [], previousTotals: [], series: [], failures: [], users: [] };
    }
    const filters = { serviceIDs: ids };
    return {
      liveRows,
      totals: await getServiceTotals(trx, range, filters),
      previousTotals: await getServiceTotals(trx, previous, filters),
      series: await getStatusSeries(trx, range, filters),
      failures: await getFailureCategories(trx, range, filters),
      users: await getUserTotals(trx, range, false, filters),
    };
  });

  const images = [...groupBy(data.totals, (r) => r.service_id).entries()].map(([image, rows]) => ({
    image, ...summarizeWorkItems(rows, range, now),
  })).sort((a, b) => b.total - a.total);

  const failureCategories = [...groupBy(data.failures, (r) => `${r.status}\n${r.message_category}`).values()]
    .map((rows) => ({
      status: rows[0].status,
      messageCategory: rows[0].message_category || null,
      count: rows.reduce((sum, r) => sum + r.count, 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_FAILURE_CATEGORIES);

  const liveByUser = groupBy(data.liveRows as LiveWorkRow[], (r) => r.username);
  const usersByName = groupBy(data.users, (r) => r.username);
  const usernames = new Set([...usersByName.keys(), ...liveByUser.keys()]);
  const users = [...usernames].map((username) => ({
    username,
    ...summarizeWorkItems(usersByName.get(username) ?? [], range, now),
    live: summarizeLiveWork(liveByUser.get(username) ?? [], now),
  })).sort((a, b) => b.computeMs - a.computeMs || b.total - a.total || b.live.ready - a.live.ready)
    .slice(0, MAX_DETAIL_USERS);

  return {
    service: serviceName,
    generatedAt: now.toISOString(),
    range: rangeJson(range),
    previousRange: rangeJson(previous),
    totals: summarizeWorkItems(data.totals, range, now),
    previousTotals: summarizeWorkItems(data.previousTotals, previous, now),
    live: summarizeLiveWork(data.liveRows, now),
    series: buildStatusSeries(data.series, range),
    histogram: buildHistogram(data.totals),
    images,
    failureCategories,
    users,
  };
}

/**
 * Parses an optional name query parameter (a service or user)
 *
 * @param value - the parameter value
 * @param name - the parameter name
 * @returns the value, or undefined if it wasn't given or is empty
 * @throws RequestValidationError if the value is too long
 */
function parseName(value: unknown, name: string): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const result = String(value);
  if (result.length > 255) {
    throw new RequestValidationError(`${name} must be at most 255 characters.`);
  }
  return result;
}

/**
 * Gets the users with the most work in a range, ranked by compute time (the summed duration of
 * their work items), with their finished job stats and live work. The filter query parameter
 * limits the users to those whose username contains it (ignoring case), before the limit applies.
 *
 * @param query - the query parameters, with lower cased keys
 * @returns the users
 */
async function buildUsers(query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const range = parseRange(query, now);
  const limit = parseLimit(query.limit, DEFAULT_USER_LIMIT, MAX_USER_LIMIT);
  const filter = parseName(query.filter, 'filter')?.toLowerCase();

  const data = await readOnly(async (trx) => ({
    totals: await getUserTotals(trx, range, false),
    jobs: await getJobTotals(trx, range, true),
    live: await getLiveWork(trx, ['username']),
  }));

  const totalsByUser = groupBy(data.totals, (r) => r.username);
  const jobsByUser = groupBy(data.jobs, (r) => r.username);
  const liveByUser = groupBy(data.live, (r) => r.username);
  const usernames = new Set([...totalsByUser.keys(), ...jobsByUser.keys(), ...liveByUser.keys()]);
  const users = [...usernames].filter((username) => !filter || username.toLowerCase().includes(filter)).map((username) => ({
    username,
    ...summarizeWorkItems(totalsByUser.get(username) ?? [], range, now),
    jobs: summarizeJobs(jobsByUser.get(username) ?? []),
    live: summarizeLiveWork(liveByUser.get(username) ?? [], now),
  })).sort((a, b) => b.computeMs - a.computeMs || b.total - a.total
    || (b.live.ready + b.live.running) - (a.live.ready + a.live.running) || a.username.localeCompare(b.username));

  return {
    generatedAt: now.toISOString(),
    range: rangeJson(range),
    totalUsers: users.length,
    users: users.slice(0, limit),
  };
}

/**
 * Gets the details of a user: their work item stats by service, a time series, their finished job
 * stats, and their live work by service.
 *
 * @param username - the user
 * @param query - the query parameters, with lower cased keys
 * @returns the details
 */
async function buildUserDetails(username: string, query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const range = parseRange(query, now);
  const filters = { username };

  const data = await readOnly(async (trx) => ({
    totals: await getUserTotals(trx, range, true, filters),
    series: await getUserSeries(trx, range, username),
    jobs: await getJobTotals(trx, range, true, filters),
    live: await getLiveWork(trx, ['service_id'], filters),
  }));

  const imageToServiceMap = getImageToServiceMap();
  const totalsByService = groupByServiceName(data.totals, imageToServiceMap);
  const liveByService = groupByServiceName(data.live, imageToServiceMap);
  const names = new Set([...totalsByService.keys(), ...liveByService.keys()]);
  const services = [...names].map((name) => ({
    name,
    ...summarizeWorkItems(totalsByService.get(name) ?? [], range, now),
    live: summarizeLiveWork(liveByService.get(name) ?? [], now),
  })).sort((a, b) => b.computeMs - a.computeMs || b.total - a.total);

  return {
    username,
    generatedAt: now.toISOString(),
    range: rangeJson(range),
    totals: summarizeWorkItems(data.totals, range, now),
    series: buildStatusSeries(data.series, range),
    services,
    jobs: summarizeJobs(data.jobs),
    live: summarizeLiveWork(data.live, now),
    jobsLink: workflowUiLinkForUser(username),
  };
}

/**
 * Gets the oldest jobs that are still running, and how many running jobs there are and appear
 * stalled
 *
 * @param query - the query parameters, with lower cased keys
 * @returns the running jobs
 */
async function buildRunningJobs(query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const limit = parseLimit(query.limit, DEFAULT_RUNNING_JOBS_LIMIT, MAX_RUNNING_JOBS_LIMIT);
  const { jobs, runningCount, stalledCount } = await readOnly(
    (trx) => getLongestRunningJobs(trx, limit, STALLED_JOB_MS, now));
  return {
    generatedAt: now.toISOString(),
    runningCount,
    stalledCount,
    stalledAfterMs: STALLED_JOB_MS,
    jobs: jobs.map((j) => ({
      jobID: j.jobID,
      username: j.username,
      status: j.status,
      progress: j.progress,
      numInputGranules: j.numInputGranules,
      serviceName: j.service_name ?? null,
      isAsync: j.isAsync,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      ageMs: now.getTime() - j.createdAt.getTime(),
      sinceUpdateMs: now.getTime() - j.updatedAt.getTime(),
      link: `/admin/workflow-ui/${j.jobID}`,
    })),
  };
}

/**
 * Gets a link to the admin workflow UI page of a job, with its work items filtered to a status
 *
 * @param jobID - the job
 * @param status - the work item status
 * @returns the link
 */
function workflowUiLinkForJobWorkItems(jobID: string, status: string): string {
  const filter = JSON.stringify([{ value: `status: ${status}`, dbValue: status, field: 'status' }]);
  return `/admin/workflow-ui/${jobID}?tableFilter=${encodeURIComponent(filter)}`;
}

/**
 * Gets the jobs with the most work items that reached a status in a range, optionally only for a
 * service and/or user - what the dashboard shows when a work item status count is selected.
 *
 * @param query - the query parameters, with lower cased keys: status (required), service, user,
 * limit, and the range parameters
 * @returns the jobs
 */
async function buildJobsWithWorkItemStatus(query: Record<string, unknown>): Promise<object> {
  const now = new Date();
  const range = parseRange(query, now);
  const limit = parseLimit(query.limit, DEFAULT_STATUS_JOBS_LIMIT, MAX_STATUS_JOBS_LIMIT);
  const status = String(query.status ?? '');
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new RequestValidationError(`status must be one of ${STATUSES.join(', ')}.`);
  }
  const service = parseName(query.service, 'service');
  const user = parseName(query.user, 'user');

  const jobs = await readOnly(async (trx) => {
    let serviceIDs: string[] | undefined;
    if (service !== undefined) {
      const imageToServiceMap = getImageToServiceMap();
      serviceIDs = (await getServiceIdsInRange(trx, range))
        .filter((id) => getServiceName(imageToServiceMap, id) === service);
      if (serviceIDs.length === 0) {
        return [];
      }
    }
    // one more than the limit, to tell whether there are more
    return getJobsWithWorkItemStatus(trx, range, status, limit + 1, { serviceIDs, username: user });
  });

  return {
    generatedAt: now.toISOString(),
    range: rangeJson(range),
    status,
    service: service ?? null,
    user: user ?? null,
    hasMore: jobs.length > limit,
    jobs: jobs.slice(0, limit).map((j) => ({
      jobID: j.jobID,
      username: j.username,
      jobStatus: j.status,
      workItemCount: j.count,
      lastUpdated: j.lastUpdated.toISOString(),
      link: workflowUiLinkForJobWorkItems(j.jobID, status),
    })),
  };
}

/**
 * Creates an express handler that responds with a (cached) dashboard API response, in the
 * requested version of its format (with the version in the response)
 *
 * @param name - the name of the endpoint, used in the cache key
 * @param build - builds the response from the request's path parameter (if any) and query
 * @returns the handler
 */
function dashboardApiHandler(
  name: string,
  build: (param: string | undefined, query: Record<string, unknown>) => Promise<object>,
): (req: HarmonyRequest, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next): Promise<void> => {
    try {
      const query = keysToLowerCase(req.query) as Record<string, unknown>;
      const version = parseVersion(query.version);
      delete query.version;
      const param = req.params?.name;
      if (param !== undefined && (param.length === 0 || param.length > 255)) {
        throw new RequestValidationError('Invalid name.');
      }
      const key = cacheKey(param === undefined ? name : `${name}/${param}`, { ...query, version });
      const body = await cached(key, () => build(param, query));
      res.json({ ...body, version });
    } catch (e) {
      next(e);
    }
  };
}

export const getDashboardSummary = dashboardApiHandler('summary', (_, query) => buildSummary(query));
export const getDashboardServiceDetails = dashboardApiHandler(
  'services', (name, query) => buildServiceDetails(name, query));
export const getDashboardUsers = dashboardApiHandler('users', (_, query) => buildUsers(query));
export const getDashboardUserDetails = dashboardApiHandler(
  'users', (name, query) => buildUserDetails(name, query));
export const getDashboardRunningJobs = dashboardApiHandler('running-jobs', (_, query) => buildRunningJobs(query));
export const getDashboardJobsByWorkItemStatus = dashboardApiHandler(
  'work-item-status-jobs', (_, query) => buildJobsWithWorkItemStatus(query));
