import { Knex } from 'knex';

import { getCurrentTime, Transaction, truncateMinuteSql } from '../util/db';

/**
 * Aggregates work_items into per-minute stats and upserts into work_items_stats.
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

  const minuteExprUpdatedAt = truncateMinuteSql(trx, '"updatedAt"');

  // Capture one additional minute just in case some work item updates have
  // an updatedAt set a few seconds prior to a transaction finishes and
  // and would otherwise be missed.
  const cutoff = new Date(new Date(watermark.last_run_at).getTime() - 60_000);

  const rows = await trx('work_items')
    .select(
      trx.raw(`${minuteExprUpdatedAt} as minute`),
      'serviceID as service_id',
      'status',
    )
    .count('* as count')
    .where('updatedAt', '>=', cutoff)
    .whereIn('status', ['failed', 'canceled', 'warning', 'successful'])
    .groupBy('minute', 'service_id', 'status');

  let written = 0;

  if (rows.length > 0) {
    const insertRows = rows.map((row) => ({
      minute: typeof row.minute === 'string' ? new Date(row.minute + 'Z') : row.minute,
      service_id: row.service_id,
      status: row.status,
      count: Number(row.count),
    }));

    const result = await trx('work_items_stats')
      .insert(insertRows)
      .onConflict(['minute', 'service_id', 'status'])
      .merge(['count'])
      .returning(['minute']);

    written = result.length;
  }

  await trx('run_watermarks')
    .where({ name: 'work_item_stats_update' })
    .update({ last_run_at: now });

  return written;
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

/** Returns a copy of `d` truncated to the start of its minute (UTC). */
function truncateToMinute(d: Date): Date {
  const truncated = new Date(d.getTime());
  truncated.setUTCSeconds(0, 0);
  return truncated;
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
 * @param trx - the database transaction
 * @param options - the time range to summarize
 * @throws TypeError if both `start` and `lastMinutes` are given, if `lastMinutes`
 *         is not a positive integer, or if the resulting range is empty
 */
export async function getWorkItemsStatsSummary(
  trx: Transaction,
  options: WorkItemsStatsTimeWindow = {},
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

  // The `minute` column is a timestamptz in Postgres and epoch millis in SQLite.
  const minuteBound = (d: Date): Knex.Raw =>
    (isPg
      ? trx.raw('?::timestamptz', [d])
      : trx.raw('CAST(? AS INTEGER)', [d.getTime()]));

  const query = trx('work_items_stats')
    .select('service_id', 'status')
    .sum('count as count');

  if (effectiveStart) {
    query.where('minute', '>=', minuteBound(effectiveStart));
  }

  query
    .andWhere('minute', '<', minuteBound(effectiveEnd))
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
