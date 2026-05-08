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

export interface WorkItemsStatsSummary {
  start: Date;
  end: Date;
  rows: { service_id: string; status: string; count: number }[];
}

/**
 * Returns a summary of work item counts grouped by service and status
 * for the last numMinutes full minutes.
 *
 * @param trx - the database transaction
 * @param numMinutes - the number of full minutes to look back
 * @param includePartialCurrentMinute - if true, includes the in-progress current minute
 *        in addition to the numMinutes full minutes; if false (default), only the
 *        numMinutes full minutes prior to the current minute are returned
 */
export async function getWorkItemsStatsSummary(
  trx: Transaction,
  numMinutes: number,
  includePartialCurrentMinute = false,
): Promise<WorkItemsStatsSummary> {
  const now = await getCurrentTime(trx);
  const isPg = trx.client.config.client === 'pg';

  // Compute the window boundaries in JS using the DB-provided `now` so the
  // returned range exactly matches what the query used.
  const currentMinute = new Date(now);
  currentMinute.setUTCSeconds(0, 0);

  const since = new Date(currentMinute);
  since.setUTCMinutes(since.getUTCMinutes() - numMinutes);

  const until = includePartialCurrentMinute
    ? new Date(currentMinute.getTime() + 60_000)
    : currentMinute;

  const startOfWindowSql = isPg
    ? trx.raw(`date_trunc('minute', ?::timestamptz - INTERVAL '${numMinutes} minutes')`, [now])
    : trx.raw('CAST(? AS INTEGER)', [since.getTime()]);

  const query = trx('work_items_stats')
    .select('service_id', 'status')
    .sum('count as count')
    .where('minute', '>=', startOfWindowSql)
    .groupBy('service_id', 'status');

  if (!includePartialCurrentMinute) {
    const endOfWindowSql = isPg
      ? trx.raw('date_trunc(\'minute\', ?::timestamptz)', [now])
      : trx.raw('CAST(? AS INTEGER)', [currentMinute.getTime()]);
    query.andWhere('minute', '<', endOfWindowSql);
  }

  const rows = await query;

  return {
    start: since,
    end: until,
    rows: rows.map((row) => ({
      service_id: row.service_id,
      status: row.status,
      count: Number(row.count),
    })),
  };
}
