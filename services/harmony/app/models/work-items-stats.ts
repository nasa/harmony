import { Knex } from 'knex';

import { durationMsSql, getCurrentTime, Transaction, truncateMinuteSql } from '../util/db';

const MS_PER_HOUR = 3_600_000;

// The upper bounds (exclusive, in ms) of the work item duration histogram buckets stored with the
// service level stats - bucket i holds durations in [bound i-1, bound i), and the last bucket holds
// everything from the last bound up. Changing these requires a migration of the stored buckets.
export const DURATION_BUCKET_UPPER_BOUNDS_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000];

export const DURATION_BUCKET_COLUMNS = Array.from(
  { length: DURATION_BUCKET_UPPER_BOUNDS_MS.length + 1 }, (_, i) => `duration_bucket_${i}`);

// The metric columns kept for work items at both the service and user levels
export const WORK_ITEM_METRIC_COLUMNS = [
  'count', 'duration_count', 'sum_duration_ms', 'max_duration_ms', 'retry_count', 'sum_items_size',
];

// The work item statuses that are aggregated (the terminal ones)
export const TERMINAL_WORK_ITEM_STATUSES = ['successful', 'failed', 'canceled', 'warning'];

// The job statuses that are aggregated (the terminal ones)
export const TERMINAL_JOB_STATUSES = ['successful', 'complete_with_errors', 'failed', 'canceled'];

/**
 * A family of stats tables: a per-minute table and its hourly rollup, which have the same columns
 * except for the time column ('minute' or 'hour')
 */
export interface StatsTableFamily {
  minuteTable: string;
  hourlyTable: string;
  // the columns (other than the time column) identifying a row
  keyColumns: string[];
  // the columns that are combined when rolling up rows - max_* columns take the maximum, and all
  // others are summed
  metricColumns: string[];
}

// The per-service work item stats (work_items_stats was the original dashboard table)
export const SERVICE_STATS: StatsTableFamily = {
  minuteTable: 'work_items_stats',
  hourlyTable: 'work_items_stats_hourly',
  keyColumns: ['service_id', 'status'],
  metricColumns: [...WORK_ITEM_METRIC_COLUMNS, ...DURATION_BUCKET_COLUMNS],
};

// The per-user (and service) work item stats
export const USER_STATS: StatsTableFamily = {
  minuteTable: 'user_work_items_stats',
  hourlyTable: 'user_work_items_stats_hourly',
  keyColumns: ['username', 'service_id', 'status'],
  metricColumns: WORK_ITEM_METRIC_COLUMNS,
};

// Counts of failed and warning work items by message category
export const FAILURE_STATS: StatsTableFamily = {
  minuteTable: 'work_items_failure_stats',
  hourlyTable: 'work_items_failure_stats_hourly',
  keyColumns: ['service_id', 'status', 'message_category'],
  metricColumns: ['count'],
};

// The per-user stats of jobs that finished (reached a terminal status)
export const JOB_STATS: StatsTableFamily = {
  minuteTable: 'job_stats',
  hourlyTable: 'job_stats_hourly',
  keyColumns: ['username', 'is_async', 'status'],
  metricColumns: ['count', 'sum_duration_ms', 'max_duration_ms', 'sum_granules', 'sum_input_size', 'sum_output_size'],
};

export const ALL_STATS_TABLE_FAMILIES = [SERVICE_STATS, USER_STATS, FAILURE_STATS, JOB_STATS];

// The maximum number of rows inserted per statement
const INSERT_BATCH_SIZE = 500;

type StatsRow = Record<string, unknown>;

/** Returns a copy of `d` truncated to the start of its minute (UTC). */
function truncateToMinute(d: Date): Date {
  const truncated = new Date(d.getTime());
  truncated.setUTCSeconds(0, 0);
  return truncated;
}

/** Returns a copy of `d` truncated to the start of its hour (UTC). */
export function truncateToHour(d: Date): Date {
  const truncated = new Date(d.getTime());
  truncated.setUTCMinutes(0, 0, 0);
  return truncated;
}

/**
 * Converts a timestamp read from the database to a Date. Postgres returns Dates, sqlite (test-only)
 * returns ms since the epoch for stored Dates and 'YYYY-MM-DD HH:MM:SS' UTC strings for computed
 * ones.
 *
 * @param value - the value read from the database
 * @returns the Date
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value as string | number);
}

// Whether an aggregated work item has a duration that should be included in duration stats
const HAS_DURATION_SQL = '(wi.status <> \'canceled\' AND wi.duration >= 0)';

/**
 * Gets the SQL to count rows of an aggregated work item query whose duration falls in a
 * histogram bucket. Canceled work items, and those without a recorded duration (-1), are never
 * counted.
 *
 * @param bucket - the index of the bucket
 * @returns the SQL expression
 */
function durationBucketSql(bucket: number): string {
  const lower = bucket === 0 ? 0 : DURATION_BUCKET_UPPER_BOUNDS_MS[bucket - 1];
  const upper = DURATION_BUCKET_UPPER_BOUNDS_MS[bucket];
  const upperCondition = upper === undefined ? '' : ` AND wi.duration < ${upper}`;
  return `SUM(CASE WHEN ${HAS_DURATION_SQL} AND wi.duration >= ${lower}${upperCondition} THEN 1 ELSE 0 END)`;
}

/**
 * Aggregates the work items updated at or after the cutoff into per-minute rows by service,
 * status, and the username of the work item's job, in a single scan of work_items.
 *
 * @param trx - the transaction to use for querying
 * @param cutoff - the start of the first minute to aggregate
 * @returns the aggregated rows, with all of the service level metric columns
 */
async function aggregateWorkItemsByUser(trx: Transaction, cutoff: Date): Promise<StatsRow[]> {
  const minute = truncateMinuteSql(trx, '"wi"."updatedAt"');
  const rows = await trx('work_items as wi')
    .leftJoin('jobs as j', 'j.jobID', 'wi.jobID')
    .select(
      trx.raw(`${minute} as minute`),
      'wi.serviceID as service_id',
      'wi.status as status',
      trx.raw('COALESCE(j.username, \'\') as username'),
      trx.raw('COUNT(*) as count'),
      trx.raw(`SUM(CASE WHEN ${HAS_DURATION_SQL} THEN 1 ELSE 0 END) as duration_count`),
      trx.raw(`SUM(CASE WHEN ${HAS_DURATION_SQL} THEN ROUND(wi.duration) ELSE 0 END) as sum_duration_ms`),
      trx.raw(`MAX(CASE WHEN ${HAS_DURATION_SQL} THEN ROUND(wi.duration) ELSE 0 END) as max_duration_ms`),
      trx.raw('SUM(wi."retryCount") as retry_count'),
      trx.raw('SUM(wi."totalItemsSize") as sum_items_size'),
      ...DURATION_BUCKET_COLUMNS.map((column, i) => trx.raw(`${durationBucketSql(i)} as ${column}`)),
    )
    .where('wi.updatedAt', '>=', cutoff)
    .whereIn('wi.status', TERMINAL_WORK_ITEM_STATUSES)
    .groupByRaw('1, 2, 3, 4');
  return rows.map((row) => ({ ...row, minute: toDate(row.minute) }));
}

/**
 * Aggregates the failed and warning work items updated at or after the cutoff into per-minute
 * counts by service, status, and message category.
 *
 * @param trx - the transaction to use for querying
 * @param cutoff - the start of the first minute to aggregate
 * @returns the aggregated rows
 */
async function aggregateWorkItemFailures(trx: Transaction, cutoff: Date): Promise<StatsRow[]> {
  const minute = truncateMinuteSql(trx, '"updatedAt"');
  const rows = await trx('work_items')
    .select(
      trx.raw(`${minute} as minute`),
      'serviceID as service_id',
      'status',
      trx.raw('COALESCE(message_category, \'\') as message_category'),
      trx.raw('COUNT(*) as count'),
    )
    .where('updatedAt', '>=', cutoff)
    .whereIn('status', ['failed', 'warning'])
    .groupByRaw('1, 2, 3, 4');
  return rows.map((row) => ({ ...row, minute: toDate(row.minute) }));
}

/**
 * Aggregates the jobs that finished (were last updated in a terminal status) at or after the
 * cutoff into per-minute rows by username, whether they were asynchronous, and status. A job's
 * duration is the time from its creation to its last update.
 *
 * @param trx - the transaction to use for querying
 * @param cutoff - the start of the first minute to aggregate
 * @returns the aggregated rows
 */
async function aggregateJobs(trx: Transaction, cutoff: Date): Promise<StatsRow[]> {
  const minute = truncateMinuteSql(trx, '"updatedAt"');
  const duration = durationMsSql(trx, '"createdAt"', '"updatedAt"');
  // jobs created before isAsync was recorded are treated as asynchronous
  const isAsync = 'COALESCE("isAsync", true)';
  const rows = await trx('jobs')
    .select(
      trx.raw(`${minute} as minute`),
      'username',
      trx.raw(`${isAsync} as is_async`),
      'status',
      trx.raw('COUNT(*) as count'),
      trx.raw(`SUM(ROUND(${duration})) as sum_duration_ms`),
      trx.raw(`MAX(ROUND(${duration})) as max_duration_ms`),
      trx.raw('SUM("numInputGranules") as sum_granules'),
      trx.raw('SUM(COALESCE(original_data_size, 0)) as sum_input_size'),
      trx.raw('SUM(COALESCE(output_data_size, 0)) as sum_output_size'),
    )
    .where('updatedAt', '>=', cutoff)
    .whereIn('status', TERMINAL_JOB_STATUSES)
    .groupByRaw('1, 2, 3, 4');
  return rows.map((row) => ({ ...row, minute: toDate(row.minute), is_async: Boolean(row.is_async) }));
}

/**
 * Combines rows that share the same time and key columns, keeping only the given columns.
 *
 * @param rows - the rows to combine
 * @param timeColumn - the time column of the output rows
 * @param timeOf - gets the time to group a row by
 * @param family - the table family whose key and metric columns the output rows have
 * @returns the combined rows
 */
function combineRows(
  rows: StatsRow[], timeColumn: string, timeOf: (row: StatsRow) => Date, family: StatsTableFamily,
): StatsRow[] {
  const combined = new Map<string, StatsRow>();
  for (const row of rows) {
    const time = timeOf(row);
    const key = JSON.stringify([time.getTime(), ...family.keyColumns.map((c) => row[c])]);
    let target = combined.get(key);
    if (!target) {
      target = { [timeColumn]: time };
      for (const c of family.keyColumns) {
        target[c] = row[c];
      }
      for (const c of family.metricColumns) {
        target[c] = 0;
      }
      combined.set(key, target);
    }
    for (const c of family.metricColumns) {
      const value = Number(row[c] ?? 0);
      target[c] = c.startsWith('max_') ? Math.max(target[c] as number, value) : (target[c] as number) + value;
    }
  }
  return [...combined.values()];
}

/**
 * Replaces all of a table's rows at or after a time with the given rows.
 *
 * @param trx - the transaction to use
 * @param table - the table
 * @param timeColumn - the table's time column
 * @param from - rows with a time at or after this are replaced
 * @param rows - the new rows
 */
async function replaceRowsFrom(
  trx: Transaction, table: string, timeColumn: string, from: Date, rows: StatsRow[],
): Promise<void> {
  await trx(table).where(timeColumn, '>=', from).del();
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    await trx(table).insert(rows.slice(i, i + INSERT_BATCH_SIZE));
  }
}

/**
 * Replaces a family's per-minute rows from the cutoff on with the given rows, then recomputes its
 * hourly rows from the start of the cutoff's hour on from the per-minute rows. Recomputing whole
 * minutes (and hours) rather than adding to them means re-aggregating a minute any number of times
 * never counts anything twice.
 *
 * @param trx - the transaction to use
 * @param family - the table family
 * @param cutoff - the start of the first minute that was aggregated
 * @param minuteRows - every row for the family's minutes from the cutoff on
 */
async function replaceStats(
  trx: Transaction, family: StatsTableFamily, cutoff: Date, minuteRows: StatsRow[],
): Promise<void> {
  await replaceRowsFrom(trx, family.minuteTable, 'minute', cutoff, minuteRows);

  const hourStart = truncateToHour(cutoff);
  const minutesInHours = await trx(family.minuteTable).where('minute', '>=', hourStart);
  const hourlyRows = combineRows(
    minutesInHours, 'hour', (row) => truncateToHour(toDate(row.minute)), family);
  await replaceRowsFrom(trx, family.hourlyTable, 'hour', hourStart, hourlyRows);
}

/**
 * Aggregates recently updated work items and finished jobs into the per-minute dashboard stats
 * tables (work_items_stats, user_work_items_stats, work_items_failure_stats, and job_stats), and
 * recomputes the hourly rollups of the hours they fall in.
 *
 * Uses a watermark table to ensure no data is missed if the cron fails or is delayed.
 * Includes partial current minute to allow continuously updating in-progress data.
 *
 * @param trx - the transaction to use for querying
 * @returns a promise resolving to the number of rows written to the work_items_stats table
 */
export async function upsertWorkItemStats(trx: Transaction): Promise<number> {
  const now = await getCurrentTime(trx);

  const watermark = await trx('run_watermarks')
    .where({ name: 'work_item_stats_update' })
    .first('last_run_at');

  if (!watermark) {
    throw new Error('Missing watermark row for work_item_stats_update');
  }

  // Capture one additional minute just in case some work item updates have
  // an updatedAt set a few seconds prior to a transaction finishes and
  // and would otherwise be missed. The cutoff must be the start of a minute: every
  // minute from the cutoff on is replaced with the counts from the queries below, so a
  // cutoff partway through a minute would replace that minute's full count with the
  // count of only the items updated after the cutoff.
  const cutoff = truncateToMinute(new Date(toDate(watermark.last_run_at).getTime() - 60_000));

  const workItemRows = await aggregateWorkItemsByUser(trx, cutoff);
  const serviceRows = combineRows(workItemRows, 'minute', (row) => row.minute as Date, SERVICE_STATS);
  await replaceStats(trx, SERVICE_STATS, cutoff, serviceRows);
  await replaceStats(trx, USER_STATS, cutoff,
    combineRows(workItemRows, 'minute', (row) => row.minute as Date, USER_STATS));
  await replaceStats(trx, FAILURE_STATS, cutoff, await aggregateWorkItemFailures(trx, cutoff));
  await replaceStats(trx, JOB_STATS, cutoff,
    combineRows(await aggregateJobs(trx, cutoff), 'minute', (row) => row.minute as Date, JOB_STATS));

  await trx('run_watermarks')
    .where({ name: 'work_item_stats_update' })
    .update({ last_run_at: now });

  return serviceRows.length;
}

/**
 * Deletes the oldest expired rows of a table, at most one hour of rows per statement and at most
 * `maxHours` hours of rows in total, so that catching up on a large backlog (or a long outage of
 * the cron) is spread across runs instead of holding one huge delete. Each statement commits on
 * its own.
 *
 * @param db - the database connection (not a transaction)
 * @param table - the table to prune
 * @param timeColumn - the table's time column
 * @param before - rows with a time before this are deleted
 * @param maxHours - the maximum number of hours of rows to delete
 * @returns the number of rows deleted
 */
async function pruneTable(
  db: Transaction, table: string, timeColumn: string, before: Date, maxHours: number,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < maxHours; i++) {
    const oldest = await db(table).min({ oldest: timeColumn }).first();
    if (oldest?.oldest === null || oldest?.oldest === undefined) {
      break;
    }
    const oldestTime = toDate(oldest.oldest);
    if (oldestTime >= before) {
      break;
    }
    const sliceEnd = new Date(Math.min(truncateToHour(oldestTime).getTime() + MS_PER_HOUR, before.getTime()));
    deleted += await db(table).where(timeColumn, '<', sliceEnd).del();
  }
  return deleted;
}

/**
 * Deletes expired rows from every dashboard stats table: per-minute rows older than the minute
 * retention period and hourly rows older than the hourly retention period.
 *
 * @param db - the database connection (not a transaction, so each delete commits on its own)
 * @param minuteRetentionDays - how many days of per-minute rows to keep
 * @param hourlyRetentionDays - how many days of hourly rows to keep
 * @param maxHoursPerTable - the maximum number of hours of rows to delete from each table
 * @returns the number of rows deleted from each table
 */
export async function pruneWorkItemStats(
  db: Transaction, minuteRetentionDays: number, hourlyRetentionDays: number, maxHoursPerTable: number,
): Promise<Record<string, number>> {
  const now = Date.now();
  const minuteCutoff = new Date(now - minuteRetentionDays * 24 * MS_PER_HOUR);
  const hourlyCutoff = new Date(now - hourlyRetentionDays * 24 * MS_PER_HOUR);
  const deleted: Record<string, number> = {};
  for (const family of ALL_STATS_TABLE_FAMILIES) {
    deleted[family.minuteTable] = await pruneTable(db, family.minuteTable, 'minute', minuteCutoff, maxHoursPerTable);
    deleted[family.hourlyTable] = await pruneTable(db, family.hourlyTable, 'hour', hourlyCutoff, maxHoursPerTable);
  }
  return deleted;
}

export interface WorkItemsStatsRow {
  service_id: string;
  status: string;
  count: number;
}

export interface WorkItemsStatsSummary {
  start: Date;
  end: Date;
  rows: WorkItemsStatsRow[];
}

//
const MS_PER_MINUTE = 60_000;

export interface WorkItemsStatsTimeWindow {
  /** The friendly human readable label to display. */
  label?: string;
  /** The index of the window in the list of time windows. */
  index?: number;
  /** Inclusive lower bound. Mutually exclusive with `lastMinutes`. */
  start?: Date;
  /** Exclusive upper bound. Defaults to the current database time. */
  end?: Date;
  /** Look back this many full minutes from `end` (or from the current minute). */
  lastMinutes?: number;
}

/**
 * Returns a summary of work item counts grouped by service and status
 * for the requested time range.
 *
 * The range can be specified as:
 *   - `{}`                        - all available data up to the current database time
 *   - `{ start }`                 - everything from `start` onward
 *   - `{ end }`                   - everything before `end`
 *   - `{ start, end }`            - an explicit half-open range [start, end)
 *   - `{ lastMinutes }`           - the most recent N *complete* minutes, i.e. the
 *                                   half-open range [currentMinute - N, currentMinute).
 *                                   The in-progress current minute is excluded.
 *   - `{ lastMinutes, end }`      - the N complete minutes preceding `end`
 *
 * `start` and `lastMinutes` are mutually exclusive.
 *
 * Ranges that start before the per-minute retention period (or have no start) are read from the
 * hourly rollups instead, since the older per-minute rows have been deleted, with the range
 * widened to whole hours - the returned `start` and `end` are the range actually summarized.
 *
 * @param trx - the database transaction
 * @param options - the time range to summarize
 * @param minuteRetentionDays - how many days of per-minute stats are kept. If omitted, the
 *        per-minute stats are always read.
 * @throws TypeError if both `start` and `lastMinutes` are given, if `lastMinutes`
 *         is not a positive integer, or if the resulting range is empty
 */
export async function getWorkItemsStatsSummary(
  trx: Transaction,
  options: WorkItemsStatsTimeWindow = {},
  minuteRetentionDays?: number,
): Promise<WorkItemsStatsSummary> {
  const { start, end, lastMinutes } = options;

  if (start && lastMinutes !== undefined) {
    throw new TypeError('getWorkItemsStatsSummary: `start` and `lastMinutes` are mutually exclusive');
  }
  if (lastMinutes !== undefined && (!Number.isInteger(lastMinutes) || lastMinutes <= 0)) {
    throw new TypeError('getWorkItemsStatsSummary: `lastMinutes` must be a positive integer');
  }

  const now = await getCurrentTime(trx);
  const isPg = trx.client.config.client === 'pg';

  // Resolve the half-open window [effectiveStart, effectiveEnd). A null start
  // means "unbounded below" - no lower bound is applied to the query.
  let effectiveStart: Date | null;
  let effectiveEnd: Date;

  if (lastMinutes !== undefined) {
    // Anchor to a minute boundary so we return whole minutes only.
    effectiveEnd = truncateToMinute(end ?? now);
    effectiveStart = new Date(effectiveEnd.getTime() - lastMinutes * MS_PER_MINUTE);
  } else {
    effectiveEnd = end ? new Date(end.getTime()) : now;
    effectiveStart = start ? new Date(start.getTime()) : null;
  }

  if (effectiveStart && effectiveStart.getTime() >= effectiveEnd.getTime()) {
    throw new TypeError('getWorkItemsStatsSummary: `start` must be before `end`');
  }

  const useHourly = minuteRetentionDays !== undefined && (!effectiveStart
    || effectiveStart.getTime() < now.getTime() - minuteRetentionDays * 24 * MS_PER_HOUR);
  if (useHourly) {
    if (effectiveStart) {
      effectiveStart = truncateToHour(effectiveStart);
    }
    effectiveEnd = new Date(Math.ceil(effectiveEnd.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
  }
  const table = useHourly ? SERVICE_STATS.hourlyTable : SERVICE_STATS.minuteTable;
  const timeColumn = useHourly ? 'hour' : 'minute';

  // The time column is a timestamptz in Postgres and epoch millis in SQLite.
  const timeBound = (d: Date): Knex.Raw =>
    (isPg
      ? trx.raw('?::timestamptz', [d])
      : trx.raw('CAST(? AS INTEGER)', [d.getTime()]));

  const query = trx(table)
    .select('service_id', 'status')
    .sum('count as count');

  if (effectiveStart) {
    query.where(timeColumn, '>=', timeBound(effectiveStart));
  }

  query
    .andWhere(timeColumn, '<', timeBound(effectiveEnd))
    .groupBy('service_id', 'status');

  const rows = await query;

  return {
    start: effectiveStart ?? new Date(0),
    end: effectiveEnd,
    rows: rows.map((row) => ({
      service_id: row.service_id,
      status: row.status,
      count: Number(row.count),
    })),
  };
}
