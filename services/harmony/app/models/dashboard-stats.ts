import { Knex } from 'knex';

import { JobStatus } from './job';
import {
  DURATION_BUCKET_COLUMNS, DURATION_BUCKET_UPPER_BOUNDS_MS, FAILURE_STATS, JOB_STATS, SERVICE_STATS,
  StatsTableFamily, toDate, truncateToHour, USER_STATS, WORK_ITEM_METRIC_COLUMNS,
} from './work-items-stats';
import { epochMsSql, Transaction } from '../util/db';
import { RequestValidationError } from '../util/errors';

// Queries for the admin dashboard. Everything here reads the aggregate stats tables populated by
// the cron service (see work-items-stats.ts) or the small user_work table - except the queries that
// are only run when an admin asks for them (getLongestRunningJobs and getJobsWithWorkItemStatus).

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

// The time range presets offered by the dashboard, and their lengths
export const RANGE_PRESETS: Record<string, number> = {
  '1h': MS_PER_HOUR,
  '6h': 6 * MS_PER_HOUR,
  '24h': MS_PER_DAY,
  '7d': 7 * MS_PER_DAY,
  '30d': 30 * MS_PER_DAY,
  '90d': 90 * MS_PER_DAY,
};

// The longest range that can be requested
export const MAX_RANGE_MS = 400 * MS_PER_DAY;

// Ranges up to this long are read from the per-minute tables, longer ones from the hourly rollups
const MAX_MINUTE_GRANULARITY_RANGE_MS = MS_PER_DAY;

// The candidate sizes of the buckets time series are divided into
const BUCKET_SIZES_MS = [
  MS_PER_MINUTE, 5 * MS_PER_MINUTE, 15 * MS_PER_MINUTE, 30 * MS_PER_MINUTE, MS_PER_HOUR,
  2 * MS_PER_HOUR, 6 * MS_PER_HOUR, 12 * MS_PER_HOUR, MS_PER_DAY, 7 * MS_PER_DAY,
];

// The maximum number of buckets in a time series chart, and in a table row's sparkline
export const MAX_SERIES_BUCKETS = 120;
export const MAX_SPARKLINE_BUCKETS = 24;

export type Granularity = 'minute' | 'hour';

/**
 * A resolved time range to report on: the half-open interval [start, end), aligned to the
 * granularity of the tables it is read from
 */
export interface StatsRange {
  start: Date;
  end: Date;
  granularity: Granularity;
  // the size of each time series bucket (a multiple of the granularity)
  bucketMs: number;
}

/**
 * Picks the smallest bucket size (no smaller than the range's granularity) that divides a range
 * into at most the given number of buckets
 *
 * @param spanMs - the length of the range
 * @param granularity - the granularity of the range
 * @param maxBuckets - the maximum number of buckets
 * @returns the bucket size in ms
 */
export function chooseBucketMs(spanMs: number, granularity: Granularity, maxBuckets: number): number {
  const minimum = granularity === 'minute' ? MS_PER_MINUTE : MS_PER_HOUR;
  const candidates = BUCKET_SIZES_MS.filter((b) => b >= minimum);
  return candidates.find((b) => spanMs / b <= maxBuckets) ?? candidates[candidates.length - 1];
}

/**
 * Resolves a requested range into the range to report on. A preset ends now: with per-minute
 * granularity at the start of the current minute (so only complete minutes are included), and with
 * hourly granularity at the end of the current hour (so the in-progress hour is included). A
 * custom range is widened to whole minutes or hours.
 *
 * @param options - the requested range: a preset name, or a custom start and end
 * @param now - the current time
 * @param minuteRetentionDays - how many days of per-minute stats are kept - ranges starting
 * earlier than that are read from the hourly rollups
 * @returns the resolved range
 * @throws RequestValidationError if the requested range is invalid
 */
export function resolveRange(
  options: { preset?: string, start?: Date, end?: Date },
  now: Date,
  minuteRetentionDays: number,
): StatsRange {
  const { preset } = options;
  let start: number;
  let end: number;
  let granularity: Granularity;

  if (preset !== undefined) {
    const spanMs = RANGE_PRESETS[preset];
    if (spanMs === undefined) {
      throw new RequestValidationError(
        `range must be one of ${Object.keys(RANGE_PRESETS).join(', ')}.`);
    }
    granularity = spanMs <= MAX_MINUTE_GRANULARITY_RANGE_MS ? 'minute' : 'hour';
    end = granularity === 'minute'
      ? Math.floor(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE
      : truncateToHour(now).getTime() + MS_PER_HOUR;
    start = end - spanMs;
  } else {
    if (!options.start || !options.end) {
      throw new RequestValidationError('Either range, or both start and end, must be provided.');
    }
    if (options.start >= options.end) {
      throw new RequestValidationError('start must be earlier than end.');
    }
    if (options.end.getTime() - options.start.getTime() > MAX_RANGE_MS) {
      throw new RequestValidationError(`The range may be at most ${MAX_RANGE_MS / MS_PER_DAY} days long.`);
    }
    const minuteDataStart = now.getTime() - minuteRetentionDays * MS_PER_DAY;
    granularity = options.end.getTime() - options.start.getTime() <= MAX_MINUTE_GRANULARITY_RANGE_MS
      && options.start.getTime() >= minuteDataStart ? 'minute' : 'hour';
    const unit = granularity === 'minute' ? MS_PER_MINUTE : MS_PER_HOUR;
    start = Math.floor(options.start.getTime() / unit) * unit;
    end = Math.ceil(options.end.getTime() / unit) * unit;
  }

  return {
    start: new Date(start),
    end: new Date(end),
    granularity,
    bucketMs: chooseBucketMs(end - start, granularity, MAX_SERIES_BUCKETS),
  };
}

/**
 * Gets the range of the same length immediately before a range, for period over period comparison.
 * If the range is read from the per-minute stats but its previous range starts before the per-minute
 * retention period (whose older rows have been deleted), the previous range is read from the hourly
 * rollups instead, widened to whole hours as resolveRange does.
 *
 * @param range - the range
 * @param now - the current time
 * @param minuteRetentionDays - how many days of per-minute stats are kept
 * @returns the previous range
 */
export function previousRange(range: StatsRange, now: Date, minuteRetentionDays: number): StatsRange {
  const spanMs = range.end.getTime() - range.start.getTime();
  const start = range.start.getTime() - spanMs;
  const minuteDataStart = now.getTime() - minuteRetentionDays * MS_PER_DAY;
  if (range.granularity === 'hour' || start >= minuteDataStart) {
    return { ...range, start: new Date(start), end: range.start };
  }
  const hourlyStart = truncateToHour(new Date(start)).getTime();
  const hourlyEnd = Math.ceil(range.start.getTime() / MS_PER_HOUR) * MS_PER_HOUR;
  return {
    start: new Date(hourlyStart),
    end: new Date(hourlyEnd),
    granularity: 'hour',
    bucketMs: chooseBucketMs(hourlyEnd - hourlyStart, 'hour', MAX_SERIES_BUCKETS),
  };
}

/**
 * Gets the same range, but with its time series divided into at most the given number of buckets
 *
 * @param range - the range
 * @param maxBuckets - the maximum number of buckets
 * @returns the range with a (possibly) larger bucket size
 */
export function withMaxBuckets(range: StatsRange, maxBuckets: number): StatsRange {
  const spanMs = range.end.getTime() - range.start.getTime();
  return { ...range, bucketMs: chooseBucketMs(spanMs, range.granularity, maxBuckets) };
}

/**
 * Gets the number of time series buckets in a range
 *
 * @param range - the range
 * @returns the number of buckets
 */
export function bucketCount(range: StatsRange): number {
  return Math.ceil((range.end.getTime() - range.start.getTime()) / range.bucketMs);
}

/**
 * Estimates a percentile of the work item durations in a histogram, assuming durations are
 * spread evenly within each bucket. The open ended last bucket is assumed to end at the maximum
 * duration, and the estimate never exceeds the maximum.
 *
 * @param buckets - the count of durations in each bucket (see DURATION_BUCKET_UPPER_BOUNDS_MS)
 * @param maxMs - the maximum duration
 * @param percentile - the percentile, between 0 and 1
 * @returns the estimated duration in ms, or null if the histogram is empty
 */
export function estimatePercentile(buckets: number[], maxMs: number, percentile: number): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return null;
  }
  const target = percentile * total;
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i++) {
    const count = buckets[i];
    if (count > 0 && cumulative + count >= target) {
      const lower = i === 0 ? 0 : DURATION_BUCKET_UPPER_BOUNDS_MS[i - 1];
      const bound = DURATION_BUCKET_UPPER_BOUNDS_MS[i] ?? Math.max(maxMs, lower);
      const upper = Math.max(lower, Math.min(bound, maxMs || bound));
      const estimate = lower + ((target - cumulative) / count) * (upper - lower);
      return Math.round(maxMs > 0 ? Math.min(estimate, maxMs) : estimate);
    }
    cumulative += count;
  }
  return maxMs;
}

/**
 * Gets the table and time column of a stats table family to read for a range
 *
 * @param family - the table family
 * @param range - the range
 * @returns the table and its time column
 */
function tableFor(family: StatsTableFamily, range: StatsRange): { table: string, timeColumn: string } {
  return range.granularity === 'minute'
    ? { table: family.minuteTable, timeColumn: 'minute' }
    : { table: family.hourlyTable, timeColumn: 'hour' };
}

/**
 * Gets the SQL for the index of the time series bucket a stats row falls in
 *
 * @param trx - the transaction
 * @param timeColumn - the table's time column
 * @param range - the range
 * @returns the SQL expression
 */
function bucketIndexSql(trx: Transaction, timeColumn: string, range: StatsRange): Knex.Raw {
  const offset = `(${epochMsSql(trx, `"${timeColumn}"`)} - ?)`;
  // the offset is never negative, so truncating is the same as taking the floor
  const sql = trx.client.config.client === 'pg'
    ? `FLOOR(${offset} / ?)`
    : `CAST(${offset} / ? AS INTEGER)`;
  return trx.raw(sql, [range.start.getTime(), range.bucketMs]);
}

/**
 * Gets the SELECT expressions summing (or taking the maximum of) the metric columns
 *
 * @param trx - the transaction
 * @param columns - the metric columns
 * @returns the expressions
 */
function metricSelects(trx: Transaction, columns: string[]): Knex.Raw[] {
  return columns.map((c) => trx.raw(c.startsWith('max_') ? 'MAX(??) AS ??' : 'SUM(??) AS ??', [c, c]));
}

/**
 * Converts the metric columns of an aggregated row to numbers (counts from Postgres can be strings)
 *
 * @param row - the row
 * @param columns - the metric columns
 * @returns the row with numeric metrics
 */
function numericRow<T extends Record<string, unknown>>(row: T, columns: string[]): T {
  const result: Record<string, unknown> = { ...row };
  for (const c of columns) {
    result[c] = Number(row[c] ?? 0);
  }
  return result as T;
}

// The work item metrics of an aggregated stats row
export interface WorkItemMetrics {
  count: number;
  duration_count: number;
  sum_duration_ms: number;
  max_duration_ms: number;
  retry_count: number;
  sum_items_size: number;
  // only for service level rows
  buckets?: number[];
}

/**
 * Extracts the duration histogram bucket columns of a row into an array
 *
 * @param row - the row
 * @returns the row's metrics, with its buckets as an array
 */
function withBuckets(row: Record<string, unknown>): WorkItemMetrics & Record<string, unknown> {
  const result = numericRow(row, [...WORK_ITEM_METRIC_COLUMNS, ...DURATION_BUCKET_COLUMNS]);
  result.buckets = DURATION_BUCKET_COLUMNS.map((c) => result[c] as number);
  for (const c of DURATION_BUCKET_COLUMNS) {
    delete result[c];
  }
  return result as unknown as WorkItemMetrics & Record<string, unknown>;
}

// Optional constraints on the stats rows read
export interface StatsFilters {
  serviceIDs?: string[];
  username?: string;
}

/**
 * Builds a query over a stats table family for a range, with the given grouping
 *
 * @param trx - the transaction
 * @param family - the table family
 * @param range - the range
 * @param groupBy - the key columns to group by
 * @param options - whether to group by time series bucket, and constraints on the rows
 * @returns the query
 */
function statsQuery(
  trx: Transaction,
  family: StatsTableFamily,
  range: StatsRange,
  groupBy: string[],
  options: { byBucket?: boolean, filters?: StatsFilters } = {},
): Knex.QueryBuilder {
  const { table, timeColumn } = tableFor(family, range);
  const selects: (string | Knex.Raw)[] = [...groupBy, ...metricSelects(trx, family.metricColumns)];
  if (options.byBucket) {
    selects.unshift(trx.raw(`${bucketIndexSql(trx, timeColumn, range).toQuery()} AS bucket`));
  }
  const query = trx(table)
    .select(selects)
    .where(timeColumn, '>=', range.start)
    .andWhere(timeColumn, '<', range.end);
  const { serviceIDs, username } = options.filters ?? {};
  if (serviceIDs) {
    query.whereIn('service_id', serviceIDs);
  }
  if (username !== undefined) {
    query.where('username', username);
  }
  const groups = options.byBucket ? ['bucket', ...groupBy] : groupBy;
  if (groups.length > 0) {
    query.groupBy(groups);
  }
  return query;
}

// Service level work item stats for a service and status
export interface ServiceStatusTotals extends WorkItemMetrics {
  service_id: string;
  status: string;
}

/**
 * Gets the work item totals for a range by service and status
 *
 * @param trx - the transaction
 * @param range - the range
 * @param filters - optional constraints on the rows
 * @returns the totals
 */
export async function getServiceTotals(
  trx: Transaction, range: StatsRange, filters?: StatsFilters,
): Promise<ServiceStatusTotals[]> {
  const rows = await statsQuery(trx, SERVICE_STATS, range, ['service_id', 'status'], { filters });
  return rows.map((r) => withBuckets(r) as unknown as ServiceStatusTotals);
}

// Service level work item stats for a status in a time series bucket
export interface StatusBucketTotals extends WorkItemMetrics {
  bucket: number;
  status: string;
}

/**
 * Gets the work item totals for each time series bucket of a range by status
 *
 * @param trx - the transaction
 * @param range - the range
 * @param filters - optional constraints on the rows
 * @returns the totals
 */
export async function getStatusSeries(
  trx: Transaction, range: StatsRange, filters?: StatsFilters,
): Promise<StatusBucketTotals[]> {
  const rows = await statsQuery(trx, SERVICE_STATS, range, ['status'], { byBucket: true, filters });
  return rows.map((r) => ({ ...withBuckets(r), bucket: Number(r.bucket) }) as unknown as StatusBucketTotals);
}

// Work item counts for a service in a time series bucket
export interface ServiceBucketCounts {
  bucket: number;
  service_id: string;
  status: string;
  count: number;
}

/**
 * Gets the work item counts for each time series bucket of a range by service and status
 *
 * @param trx - the transaction
 * @param range - the range
 * @returns the counts
 */
export async function getServiceSeries(trx: Transaction, range: StatsRange): Promise<ServiceBucketCounts[]> {
  const { table, timeColumn } = tableFor(SERVICE_STATS, range);
  const rows = await trx(table)
    .select(
      trx.raw(`${bucketIndexSql(trx, timeColumn, range).toQuery()} AS bucket`),
      'service_id', 'status', trx.raw('SUM(count) AS count'))
    .where(timeColumn, '>=', range.start)
    .andWhere(timeColumn, '<', range.end)
    .groupBy(['bucket', 'service_id', 'status']);
  return rows.map((r) => ({
    bucket: Number(r.bucket), service_id: r.service_id, status: r.status, count: Number(r.count),
  }));
}

// User level work item stats
export interface UserTotals extends WorkItemMetrics {
  username: string;
  service_id?: string;
  status: string;
}

/**
 * Gets the work item totals for a range by user (and optionally service) and status
 *
 * @param trx - the transaction
 * @param range - the range
 * @param byService - whether to also group by service
 * @param filters - optional constraints on the rows
 * @returns the totals
 */
export async function getUserTotals(
  trx: Transaction, range: StatsRange, byService: boolean, filters?: StatsFilters,
): Promise<UserTotals[]> {
  const groupBy = byService ? ['username', 'service_id', 'status'] : ['username', 'status'];
  const rows = await statsQuery(trx, USER_STATS, range, groupBy, { filters });
  return rows.map((r) => numericRow(r, WORK_ITEM_METRIC_COLUMNS) as unknown as UserTotals);
}

// User level work item stats in a time series bucket
export interface UserBucketTotals extends WorkItemMetrics {
  bucket: number;
  status: string;
}

/**
 * Gets the work item totals for each time series bucket of a range for a user by status
 *
 * @param trx - the transaction
 * @param range - the range
 * @param username - the user
 * @returns the totals
 */
export async function getUserSeries(
  trx: Transaction, range: StatsRange, username: string,
): Promise<UserBucketTotals[]> {
  const rows = await statsQuery(trx, USER_STATS, range, ['status'], { byBucket: true, filters: { username } });
  return rows.map((r) => ({
    ...numericRow(r, WORK_ITEM_METRIC_COLUMNS), bucket: Number(r.bucket),
  }) as unknown as UserBucketTotals);
}

// A count of failed or warning work items with a message category
export interface FailureCategoryCount {
  service_id: string;
  status: string;
  message_category: string;
  count: number;
}

/**
 * Gets the counts of failed and warning work items for a range by service, status, and message
 * category
 *
 * @param trx - the transaction
 * @param range - the range
 * @param filters - optional constraints on the rows
 * @returns the counts
 */
export async function getFailureCategories(
  trx: Transaction, range: StatsRange, filters?: StatsFilters,
): Promise<FailureCategoryCount[]> {
  const rows = await statsQuery(
    trx, FAILURE_STATS, range, ['service_id', 'status', 'message_category'], { filters });
  return rows.map((r) => numericRow(r, ['count']) as unknown as FailureCategoryCount);
}

// Stats of the jobs that finished in a range
export interface JobTotals {
  username?: string;
  is_async: boolean;
  status: string;
  count: number;
  sum_duration_ms: number;
  max_duration_ms: number;
  sum_granules: number;
  sum_input_size: number;
  sum_output_size: number;
}

/**
 * Gets the stats of the jobs that finished in a range by whether they were asynchronous and status,
 * and optionally by user
 *
 * @param trx - the transaction
 * @param range - the range
 * @param byUser - whether to also group by user
 * @param filters - optional constraints on the rows
 * @returns the totals
 */
export async function getJobTotals(
  trx: Transaction, range: StatsRange, byUser: boolean, filters?: StatsFilters,
): Promise<JobTotals[]> {
  const groupBy = byUser ? ['username', 'is_async', 'status'] : ['is_async', 'status'];
  const rows = await statsQuery(trx, JOB_STATS, range, groupBy, { filters });
  return rows.map((r) => ({
    ...numericRow(r, JOB_STATS.metricColumns), is_async: Boolean(r.is_async),
  }) as unknown as JobTotals);
}

// A job that has not finished
export interface UnfinishedJob {
  jobID: string;
  username: string;
  status: string;
  progress: number;
  numInputGranules: number;
  service_name: string;
  isAsync: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UNFINISHED_JOB_STATUSES = [JobStatus.ACCEPTED, JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS];

/**
 * Gets the oldest jobs that are still running, and the number of running jobs that haven't been
 * updated within the stall threshold. This reads the jobs table, but only the (indexed) unfinished
 * jobs, and is only run when requested from the dashboard.
 *
 * @param trx - the transaction
 * @param limit - the maximum number of jobs to return
 * @param stalledAfterMs - running jobs not updated for at least this long are counted as stalled
 * @param now - the current time
 * @returns the oldest running jobs, the number of running jobs, and the number that are stalled
 */
export async function getLongestRunningJobs(
  trx: Transaction, limit: number, stalledAfterMs: number, now: Date,
): Promise<{ jobs: UnfinishedJob[], runningCount: number, stalledCount: number }> {
  const jobs = await trx('jobs')
    .select('jobID', 'username', 'status', 'progress', 'numInputGranules', 'service_name', 'isAsync',
      'createdAt', 'updatedAt')
    .whereIn('status', UNFINISHED_JOB_STATUSES)
    .orderBy('createdAt', 'asc')
    .limit(limit);
  const countRows = await trx('jobs')
    .select(
      trx.raw('COUNT(*) AS running'),
      trx.raw('SUM(CASE WHEN "updatedAt" < ? THEN 1 ELSE 0 END) AS stalled', [new Date(now.getTime() - stalledAfterMs)]),
    )
    .whereIn('status', UNFINISHED_JOB_STATUSES);
  const counts = (countRows as unknown as { running?: number | string, stalled?: number | string }[])[0];
  return {
    jobs: jobs.map((j) => ({
      ...j, isAsync: Boolean(j.isAsync), createdAt: toDate(j.createdAt), updatedAt: toDate(j.updatedAt),
    })),
    runningCount: Number(counts?.running ?? 0),
    stalledCount: Number(counts?.stalled ?? 0),
  };
}

// A job with work items that reached a status in a range
export interface JobWithWorkItemStatus {
  jobID: string;
  username: string;
  // the job's own status
  status: string;
  // the number of the job's work items that reached the status in the range
  count: number;
  // the last time one of them did
  lastUpdated: Date;
}

/**
 * Gets the jobs with the most work items that reached a (terminal) status in a range. Unlike the
 * other dashboard queries this reads work_items - using its ("updatedAt", status, "serviceID")
 * index - so it's only run when an admin asks for it, and is bounded by the dashboard's statement
 * timeout. Work items of finished jobs are deleted by the work reaper after a while, so jobs from
 * the start of a long range may be missing.
 *
 * @param trx - the transaction
 * @param range - the range
 * @param status - the work item status
 * @param limit - the maximum number of jobs to return
 * @param filters - optional constraints on the work items' services and jobs' users
 * @returns the jobs, with the most matching work items first
 */
export async function getJobsWithWorkItemStatus(
  trx: Transaction, range: StatsRange, status: string, limit: number, filters: StatsFilters = {},
): Promise<JobWithWorkItemStatus[]> {
  const query = trx('work_items as wi')
    .join('jobs as j', 'j.jobID', 'wi.jobID')
    .select(
      'wi.jobID as jobID', 'j.username as username', 'j.status as status',
      trx.raw('COUNT(*) AS count'), trx.raw('MAX("wi"."updatedAt") AS last_updated'))
    .where('wi.updatedAt', '>=', range.start)
    .andWhere('wi.updatedAt', '<', range.end)
    .andWhere('wi.status', status)
    .groupBy('wi.jobID', 'j.username', 'j.status')
    .orderByRaw('COUNT(*) DESC, MAX("wi"."updatedAt") DESC')
    .limit(limit);
  if (filters.serviceIDs) {
    query.whereIn('wi.serviceID', filters.serviceIDs);
  }
  if (filters.username !== undefined) {
    query.where('j.username', filters.username);
  }
  const rows = await query;
  return rows.map((r) => ({
    jobID: r.jobID,
    username: r.username,
    status: r.status,
    count: Number(r.count),
    lastUpdated: toDate(r.last_updated),
  }));
}

/**
 * Gets the time the dashboard stats were last updated by the cron service
 *
 * @param trx - the transaction
 * @returns the time of the last update, or null if it has never run
 */
export async function getStatsLastUpdated(trx: Transaction): Promise<Date | null> {
  const row = await trx('run_watermarks').where({ name: 'work_item_stats_update' }).first('last_run_at');
  return row ? toDate(row.last_run_at) : null;
}

/**
 * Gets the IDs (images) of the services with any work item stats in a range
 *
 * @param trx - the transaction
 * @param range - the range
 * @returns the service IDs
 */
export async function getServiceIdsInRange(trx: Transaction, range: StatsRange): Promise<string[]> {
  const { table, timeColumn } = tableFor(SERVICE_STATS, range);
  const rows = await trx(table)
    .distinct('service_id')
    .where(timeColumn, '>=', range.start)
    .andWhere(timeColumn, '<', range.end);
  return rows.map((r) => r.service_id);
}
