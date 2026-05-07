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
  const minuteExprWatermark = trx.client.config.client === 'pg'
    ? truncateMinuteSql(trx, "?::timestamptz - INTERVAL '1 minute'")
    : truncateMinuteSql(trx, "DATETIME(?, '-1 minute')");

  const rows = await trx('work_items')
    .select(
      trx.raw(`${minuteExprUpdatedAt} as minute`),
      'serviceID as service_id',
      'status',
    )
    .count('* as count')
    .where('updatedAt', '>=', trx.raw(minuteExprWatermark, [watermark.last_run_at]))
    .whereIn('status', ['failed', 'canceled', 'warning', 'successful'])
    .groupBy('minute', 'service_id', 'status');

  // if (rows.length > 0) {
  //   const insertRows = rows.map((row) => ({
  //     minute: row.minute,
  //     service_id: row.service_id,
  //     status: row.status,
  //     count: Number(row.count),
  //   }));

  //   await trx('work_items_stats')
  //     .insert(insertRows)
  //     .onConflict(['minute', 'service_id', 'status'])
  //     .merge(['count']);
  // }
  let written = 0;

  if (rows.length > 0) {
    const insertRows = rows.map((row) => ({
      minute: row.minute,
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

// export async function upsertWorkItemStats(
//   trx: Transaction,
// ): Promise<void> {
//   const [{ now }] = await trx.raw('SELECT NOW() as now');
//   const [{ last_run_at }] = await trx('run_watermarks')
//     .where({ name: 'work_item_stats_update' })
//     .select('last_run_at');

//   const earliest_minute = trx.raw(
//     'date_trunc(\'minute\', ?)',
//     [last_run_at],
//   );

//   const rows = await trx('work_items')
//     .select(
//       trx.raw('date_trunc(\'minute\', "updatedAt") as minute'),
//       'serviceID as service_id',
//       'status',
//     )
//     .count('* as count')
//     .where('updatedAt', '>=', earliest_minute)
//     .whereIn('status', [
//       'failed',
//       'canceled',
//       'warning',
//       'successful',
//     ])
//     .groupByRaw('1,2,3');

//   if (rows.length > 0) {
//     const insertRows = rows.map((row) => ({
//       minute: row.minute,
//       service_id: row.service_id,
//       status: row.status,
//       count: Number(row.count),
//     }));

//     await trx('work_items_stats')
//       .insert(insertRows)
//       .onConflict(['minute', 'service_id', 'status'])
//       .merge({
//         count: trx.raw('EXCLUDED.count'),
//       });
//   }

//   await trx('run_watermarks')
//     .where({ name: 'work_item_stats_update' })
//     .update({
//       last_run_at: now,
//     });
// }
