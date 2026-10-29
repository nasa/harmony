import { subDays } from 'date-fns';

import { Transaction } from '../util/db';

// The most recent jobs of a user's history for a service that are averaged to seed the
// average_duration of a new job for that service. This bounds the cost of the seeding query (it
// runs on job creation) for users with very many jobs, and favors the user's recent jobs.
export const MAX_SEED_JOBS = 100;

/**
 * The duration totals of a job and service's work items, kept after its user_work row is deleted.
 *
 * user_work rows are deleted as soon as the job no longer has work for the service (or the job is
 * paused) so the fair queueing queries stay fast, so the totals are moved here first. There is at
 * most one row per job and service: when a paused job is resumed its totals are restored to its new
 * user_work rows (see restoreOrSeedUserWorkDurations in user-work.ts), so the next time those rows
 * are deleted they hold the job's full totals and overwrite this row rather than adding to it.
 */
export default class UserWorkHistory {
  static table = 'user_work_history';

  id: number;

  job_id: string;

  service_id: string;

  username: string;

  is_async: boolean;

  // the number of successful (or warning) work items, which are the only work items whose
  // durations are factored into user_work's average_duration
  completed_count: number;

  // the summed duration (in ms) of those work items
  sum_duration_ms: number;

  // the number of work items that failed (after any retries) and their summed duration (in ms)
  failed_count: number;

  failed_sum_duration_ms: number;

  // when the job was first worked for the service (the user_work row's createdAt)
  first_worked_at: Date;

  // the last time the job and service's totals were written to this row
  retired_at: Date;

  createdAt: Date;

  updatedAt: Date;
}

/**
 * The duration of a just-completed work item, along with whether it failed. Canceled work items
 * never have one - their durations aren't tracked at all.
 */
export interface CompletedWorkItemDuration {
  durationMs: number;
  failed: boolean;
}

/**
 * The fields of a deleted user_work row needed to record its totals in user_work_history
 */
export interface DeletedUserWorkRow {
  job_id: string;
  service_id: string;
  username: string;
  is_async: boolean;
  average_duration: number | null;
  completed_count: number;
  failed_count: number;
  failed_sum_duration_ms: number;
  createdAt: Date;
}

// The columns of user_work_history written by an insert, in the order of the VALUES lists below
const INSERT_COLUMNS = [
  'job_id', 'service_id', 'username', 'is_async', 'completed_count', 'sum_duration_ms',
  'failed_count', 'failed_sum_duration_ms', 'first_worked_at', 'retired_at', 'createdAt', 'updatedAt',
];

const INSERT_COLUMNS_SQL = INSERT_COLUMNS.map((c) => `"${c}"`).join(', ');

const VALUES_ROW_SQL = `(${INSERT_COLUMNS.map(() => '?').join(', ')})`;

/**
 * Get the INSERT bindings for one user_work_history row
 *
 * @param row - the values to insert
 * @param now - the time to use for retired_at, createdAt, and updatedAt
 * @returns the bindings, in INSERT_COLUMNS order
 */
function insertBindings(
  row: Omit<UserWorkHistory, 'id' | 'retired_at' | 'createdAt' | 'updatedAt'>,
  now: Date,
): unknown[] {
  return [
    row.job_id, row.service_id, row.username, row.is_async, row.completed_count,
    row.sum_duration_ms, row.failed_count, row.failed_sum_duration_ms, row.first_worked_at ?? null,
    now, now, now,
  ];
}

/**
 * Records the duration totals of user_work rows that have just been deleted in user_work_history.
 * A row's totals replace any already recorded for its job and service, since a user_work row holds
 * its job and service's full totals (restored from this table when a paused job is resumed). As a
 * safeguard, an existing row is only replaced by one with at least as many work items, so a
 * user_work row recreated without its totals can never shrink them. Rows without any completed or
 * failed work items are skipped - in particular this means a seeded average_duration (which has a
 * completed_count of 0) is never recorded as if it were measured.
 *
 * @param tx - The database transaction
 * @param rows - The deleted user_work rows
 */
export async function moveUserWorkRowsToHistory(tx: Transaction, rows: DeletedUserWorkRow[]): Promise<void> {
  const toRecord = rows.filter((r) => r.completed_count > 0 || r.failed_count > 0);
  if (toRecord.length === 0) {
    return;
  }
  const now = new Date();
  const bindings = toRecord.flatMap((r) => insertBindings({
    job_id: r.job_id,
    service_id: r.service_id,
    username: r.username,
    is_async: r.is_async,
    completed_count: r.completed_count,
    // average_duration is rounded to the ms after every completion, so this is approximate. The
    // roundings mostly cancel out, leaving an error that is a tiny fraction of the total.
    sum_duration_ms: r.completed_count > 0 ? Math.round((r.average_duration ?? 0) * r.completed_count) : 0,
    failed_count: r.failed_count,
    failed_sum_duration_ms: r.failed_sum_duration_ms,
    first_worked_at: r.createdAt,
  }, now));

  await tx.raw(`
    INSERT INTO user_work_history (${INSERT_COLUMNS_SQL})
    VALUES ${toRecord.map(() => VALUES_ROW_SQL).join(', ')}
    ON CONFLICT (job_id, service_id) DO UPDATE SET
      completed_count = excluded.completed_count,
      sum_duration_ms = excluded.sum_duration_ms,
      failed_count = excluded.failed_count,
      failed_sum_duration_ms = excluded.failed_sum_duration_ms,
      -- the row may have been created by addCompletionToUserWorkHistory, which doesn't know it
      first_worked_at = COALESCE(user_work_history.first_worked_at, excluded.first_worked_at),
      retired_at = excluded.retired_at,
      "updatedAt" = excluded."updatedAt"
    WHERE excluded.completed_count + excluded.failed_count
      >= user_work_history.completed_count + user_work_history.failed_count
  `, bindings);
}

/**
 * Adds a just-completed work item's duration to the user_work_history totals for its job and
 * service. This is only for work items that complete while their job is paused: pausing a job
 * deletes its user_work rows, but work items that are already running keep running and report
 * back, and their durations would otherwise be lost. The totals are restored to the job's user_work
 * rows when it is resumed.
 *
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @param username - The username of the job's owner
 * @param isAsync - Whether the job is asynchronous
 * @param completed - The duration of the work item and whether it failed
 */
export async function addCompletionToUserWorkHistory(
  tx: Transaction,
  jobID: string,
  serviceID: string,
  username: string,
  isAsync: boolean,
  completed: CompletedWorkItemDuration,
): Promise<void> {
  const durationMs = Math.round(completed.durationMs);
  const bindings = insertBindings({
    job_id: jobID,
    service_id: serviceID,
    username,
    is_async: isAsync,
    completed_count: completed.failed ? 0 : 1,
    sum_duration_ms: completed.failed ? 0 : durationMs,
    failed_count: completed.failed ? 1 : 0,
    failed_sum_duration_ms: completed.failed ? durationMs : 0,
    first_worked_at: null,
  }, new Date());

  await tx.raw(`
    INSERT INTO user_work_history (${INSERT_COLUMNS_SQL})
    VALUES ${VALUES_ROW_SQL}
    ON CONFLICT (job_id, service_id) DO UPDATE SET
      completed_count = user_work_history.completed_count + excluded.completed_count,
      sum_duration_ms = user_work_history.sum_duration_ms + excluded.sum_duration_ms,
      failed_count = user_work_history.failed_count + excluded.failed_count,
      failed_sum_duration_ms = user_work_history.failed_sum_duration_ms + excluded.failed_sum_duration_ms,
      retired_at = excluded.retired_at,
      "updatedAt" = excluded."updatedAt"
  `, bindings);
}

/**
 * Gets the user_work_history rows for a job, keyed by service ID
 *
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @returns the job's rows keyed by service ID
 */
export async function getUserWorkHistoryForJob(
  tx: Transaction, jobID: string,
): Promise<Record<string, UserWorkHistory>> {
  const rows: UserWorkHistory[] = await tx(UserWorkHistory.table).where({ job_id: jobID });
  return Object.fromEntries(rows.map((r) => [r.service_id, r]));
}

/**
 * Gets the average work item duration (in ms) of a user's recent jobs for each of the given
 * services, used to seed the average_duration of a new job's user_work rows so that duration based
 * fair queueing can classify the job before any of its own work items complete. Only the user's
 * MAX_SEED_JOBS most recent jobs for each service within the lookback period are averaged, weighted
 * by their number of completed work items.
 *
 * @param tx - The database transaction
 * @param username - The username of the job's owner
 * @param serviceIDs - The service IDs to get averages for
 * @param lookbackDays - How many days of history to consider. 0 disables seeding.
 * @returns the average duration for each service with any recent history, keyed by service ID
 */
export async function getSeedAverageDurations(
  tx: Transaction, username: string, serviceIDs: string[], lookbackDays: number,
): Promise<Record<string, number>> {
  const seeds: Record<string, number> = {};
  if (!lookbackDays || lookbackDays <= 0) {
    return seeds;
  }
  const cutoff = subDays(new Date(), lookbackDays);
  for (const serviceID of new Set(serviceIDs)) {
    const recentJobs = tx(UserWorkHistory.table)
      .select('sum_duration_ms', 'completed_count')
      .where({ username, service_id: serviceID })
      .andWhere('retired_at', '>=', cutoff)
      .andWhere('completed_count', '>', 0)
      .orderBy('retired_at', 'desc')
      .limit(MAX_SEED_JOBS)
      .as('recent_jobs');
    const result = await tx.from(recentJobs)
      .sum({ sumDuration: 'sum_duration_ms', count: 'completed_count' })
      .first();
    const count = Number(result?.count);
    if (count > 0) {
      seeds[serviceID] = Math.round(Number(result.sumDuration) / count);
    }
  }
  return seeds;
}

/**
 * Gets the IDs of user_work_history rows last written before the given time for jobs that are in
 * a terminal state (or no longer exist), in ID order, starting after the given ID. Rows for jobs
 * that aren't finished are kept regardless of age, so a job paused for longer than the retention
 * period still has its totals restored when it is resumed.
 *
 * @param tx - The database transaction
 * @param retiredBefore - Only rows with a retired_at before this time are returned
 * @param terminalStatuses - The terminal job statuses
 * @param startingId - Only rows with an ID greater than this are returned
 * @param limit - The maximum number of IDs to return
 * @returns the IDs of the expired rows
 */
export async function getExpiredUserWorkHistoryIds(
  tx: Transaction,
  retiredBefore: Date,
  terminalStatuses: string[],
  startingId: number,
  limit: number,
): Promise<number[]> {
  const rows = await tx(`${UserWorkHistory.table} as h`)
    .select('h.id')
    .leftJoin('jobs as j', 'j.jobID', 'h.job_id')
    .where('h.retired_at', '<', retiredBefore)
    .andWhere('h.id', '>', startingId)
    .andWhere((q) => q.whereNull('j.jobID').orWhereIn('j.status', terminalStatuses))
    .orderBy('h.id', 'asc')
    .limit(limit);
  return rows.map((r) => Number(r.id));
}

/**
 * Deletes the user_work_history rows with the given IDs
 *
 * @param tx - The database transaction
 * @param ids - The IDs of the rows to delete
 * @returns the number of rows deleted
 */
export async function deleteUserWorkHistoryByIds(tx: Transaction, ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  return tx(UserWorkHistory.table).whereIn('id', ids).del();
}
