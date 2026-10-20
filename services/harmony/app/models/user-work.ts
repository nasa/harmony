import { Knex } from 'knex';

import Record from './record';
import WorkItem from './work-item';
import db, { Transaction } from '../util/db';
import env from '../util/env';

// Expected runtime (in ms) assumed for in-progress work with no measured average_duration yet,
// used only for ranking users by total expected runtime
const DEFAULT_EXPECTED_DURATION_MS = 60 * 60 * 1000;

// Expected runtime (in ms) of a user_work row's running work items, with one binding for the
// default duration. Cast to BIGINT before multiplying - with integer columns postgres overflows
// 32 bits once running_count * duration passes ~2.1 billion (e.g. 597 unmeasured running items).
const EXPECTED_RUNTIME_SQL = 'CAST(running_count AS BIGINT) * COALESCE(average_duration, ?)';

/**
 *
 * Wrapper object for aggregated information tracking the work items summary for a job and service
 *
 */
export default class UserWork extends Record {
  static table = 'user_work';

  // The ID of the job
  job_id: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  service_id: string;

  // The username associated with the job
  username: string;

  // the number of work items in the ready state for this job and service
  ready_count: number;

  // the number of work items in the running state for this job and service
  running_count: number;

  // true if the requested job is asynchronous
  is_async: boolean;

  // the time the job was last worked
  last_worked: Date;

  // the mean duration (in ms) of completed work items for this job and service, or null until
  // the first work item for this job and service has completed
  average_duration: number;

  // the number of completed work items factored into average_duration so far
  completed_count: number;
}

/**
 * Get a count of work items in the ready or running state for the given service ID
 *
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @returns The sum of ready and running work items for the service
 */
export async function getQueuedOrRunningCountForService(tx: Transaction, serviceID: string)
  : Promise<number> {
  const results = await tx(UserWork.table)
    .sum({ readyCount: 'ready_count', runningCount: 'running_count' })
    .where({ service_id: serviceID });

  const totalItems = Number(results[0].readyCount) + Number(results[0].runningCount);

  return totalItems;
}

/**
 * Returns the maximum number of work items for a service that may be running at once for jobs
 * classified as "slow", i.e. the share of the service's capacity not held back by
 * `env.fastLaneReserveFraction`. Always at least 1 so slow work can make progress on a service
 * with very few pods.
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @returns the maximum number of slow work items that may be running for the service
 */
export function getSlowWorkCapacity(servicePodCount: number): number {
  // the small epsilon guards against floating point products like 48.99999999999999
  return Math.max(1, Math.floor(servicePodCount * (1 - env.fastLaneReserveFraction) + 1e-9));
}

/**
 * Returns true if slow work for the service is already using its full share of the service's
 * capacity (see getSlowWorkCapacity), in which case only work classified as "fast" should be
 * scheduled, so that short work keeps flowing even while slow work occupies most of the service.
 * Only work items running for jobs actively classified as slow (measured average_duration above
 * env.slowWorkThresholdMs) count against that capacity - fast and not-yet-measured work does not.
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @returns true if only fast work should be scheduled for the service
 */
async function isFastLaneOnly(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<boolean> {
  const row = await tx(UserWork.table)
    .where('service_id', serviceID)
    .where('average_duration', '>', env.slowWorkThresholdMs)
    .sum({ slowRunningCount: 'running_count' })
    .first();
  const slowRunningCount = Number(row?.slowRunningCount) || 0;
  return slowRunningCount >= getSlowWorkCapacity(servicePodCount);
}

/**
 * Restricts a user_work query to rows not classified as "slow": those with a measured
 * average_duration at or below the slow work threshold, or that have no measured duration and
 * no work item currently running or completed for this job and service (so Harmony can measure
 * a new job's duration without letting unmeasured work flood the service).
 * @param query - A knex query builder for the user_work table to restrict in place
 */
function restrictToFastWork(query: Knex.QueryBuilder): void {
  query.andWhere(function (this: Knex.QueryBuilder) {
    this.where('average_duration', '<=', env.slowWorkThresholdMs)
      .orWhere(function (this: Knex.QueryBuilder) {
        this.whereNull('average_duration')
          .andWhere('running_count', 0)
          .andWhere('completed_count', 0);
      });
  });
}

/**
 * Gets the next username that should have a work item worked for the given service ID.
 * Ranks eligible users by the expected runtime of their in-progress work (running_count times
 * average_duration, or a default duration when unmeasured) across all services, breaking ties
 * by the user who least recently had work performed. When the service's fast lane reserve
 * capacity has been reached, only users with ready "fast" work for the service are eligible.
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @returns The username that should have a work item worked next
 */
export async function getNextUsernameForWork(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<string> {
  const fastLaneOnly = await isFastLaneOnly(tx, serviceID, servicePodCount);

  const subquery = tx(UserWork.table)
    .distinct('username')
    .where('service_id', '=', serviceID)
    .where('ready_count', '>', 0);

  if (fastLaneOnly) {
    restrictToFastWork(subquery);
  }

  const results = await tx(UserWork.table)
    .select('username')
    .max('last_worked as lw')
    .select(tx.raw(`SUM(${EXPECTED_RUNTIME_SQL}) as expected_runtime`, [DEFAULT_EXPECTED_DURATION_MS]))
    .whereIn('username', subquery)
    .groupBy('username')
    .orderBy('expected_runtime', 'asc')
    .orderBy('lw', 'asc')
    .first();

  return results?.username;
}

/**
 * Gets the next job to work on for the given username and service ID. When the service's fast
 * lane reserve capacity has been reached, only jobs with ready "fast" work for the service are
 * considered.
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @param username - The username to choose a job to work on
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @returns The job ID that should have a work item worked next for the service
 */
export async function getNextJobIdForUsernameAndService(
  tx: Transaction, serviceID: string, username: string, servicePodCount: number,
): Promise<string> {
  const fastLaneOnly = await isFastLaneOnly(tx, serviceID, servicePodCount);

  const query = tx(UserWork.table)
    .select('job_id')
    .where({ username, service_id: serviceID })
    .where('ready_count', '>', 0);

  if (fastLaneOnly) {
    restrictToFastWork(query);
  }

  const results = await query
    .orderBy('is_async', 'asc')
    .orderBy('last_worked', 'asc')
    .first();

  return results?.job_id;
}

// A job returned by getNextJobIds, flagged with whether it is classified as slow for the service
export interface NextJob {
  jobId: string;
  isSlow: boolean;
}

// The result of getNextJobIds
export interface NextJobs {
  // the jobs to work, in fair queueing priority order
  jobs: NextJob[];
  // the number of slow work items that may still be scheduled for the service, never less than 0
  availableSlowWorkSlots: number;
}

/**
 * Returns the jobIds with the oldest last_worked value and ready count greater than 0 and interleaved by username.
 * This query enforces the fair queueing by returning the job ids in the order of fair queueing priority:
 * users are grouped into interleaving "rounds" (one job per user per round, oldest-worked job first within
 * each user), and rounds/users are ordered by each user's expected runtime of in-progress work (across all
 * services) rather than by recency alone.
 *
 * Slow jobs are ranked by the same rules as every other job. Work items running for jobs actively classified
 * as slow count against the service's slow work capacity (see getSlowWorkCapacity); once that capacity is
 * used up, slow jobs are excluded entirely (same criteria as restrictToFastWork). The remaining slow work
 * capacity is computed in the same query and returned so that callers can avoid handing out more slow work
 * items than are available.
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param batchSize - The batch size
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @returns The list of jobs in fair queuing priority and the number of available slow work slots
 */
export async function getNextJobIds(
  tx: Transaction,
  serviceID: string,
  batchSize: number,
  servicePodCount: number,
): Promise<NextJobs> {
  const slowWorkCapacity = getSlowWorkCapacity(servicePodCount);

  const sql = `
    WITH SlowInUse AS (
      SELECT COALESCE(SUM(running_count), 0) AS slow_running_count
      FROM user_work
      WHERE service_id = ?
        AND average_duration > ?
    ),
    Eligible AS (
      SELECT
        uw.job_id,
        uw.last_worked,
        uw.username,
        uw.is_async,
        CASE WHEN uw.average_duration > ? THEN 1 ELSE 0 END AS is_slow
      FROM user_work uw
      CROSS JOIN SlowInUse s
      WHERE uw.service_id = ?
        AND uw.ready_count > 0
        AND (
          s.slow_running_count < ?
          OR (uw.average_duration IS NOT NULL AND uw.average_duration <= ?)
          OR (uw.average_duration IS NULL AND uw.running_count = 0 AND uw.completed_count = 0)
        )
    ),
    UserRank AS (
      SELECT
        username,
        SUM(${EXPECTED_RUNTIME_SQL}) AS expected_runtime,
        MAX(last_worked) AS most_recent_worked
      FROM user_work
      WHERE username IN (SELECT DISTINCT username FROM Eligible)
      GROUP BY username
    ),
    RankedJobs AS (
      SELECT
        e.job_id,
        e.last_worked,
        e.username,
        e.is_async,
        e.is_slow,
        ROW_NUMBER() OVER (
          PARTITION BY e.username
          ORDER BY e.last_worked ASC
        ) AS user_row_num
      FROM Eligible e
    ),
    Interleaved AS (
      SELECT
        R.job_id,
        R.is_async,
        R.is_slow,
        ROW_NUMBER() OVER (
          ORDER BY R.user_row_num ASC, ur.expected_runtime ASC, ur.most_recent_worked ASC, R.last_worked ASC
        ) AS overall_row_num
      FROM RankedJobs R
      JOIN UserRank ur ON ur.username = R.username
    )
    SELECT uw.job_id, i.is_slow, s.slow_running_count
    FROM user_work uw
    JOIN Interleaved i
      ON i.job_id = uw.job_id
    CROSS JOIN SlowInUse s
    WHERE uw.service_id = ?
      AND i.overall_row_num <= ?
    ORDER BY i.is_async, i.overall_row_num
    FOR UPDATE OF uw SKIP LOCKED
  `;

  const results = await tx.raw(sql, [
    serviceID,
    env.slowWorkThresholdMs,
    env.slowWorkThresholdMs,
    serviceID,
    slowWorkCapacity,
    env.slowWorkThresholdMs,
    DEFAULT_EXPECTED_DURATION_MS,
    serviceID,
    batchSize,
  ]);

  const rows = results.rows || [];
  // every row carries the same service-wide count; with no rows there are no jobs to limit
  const slowRunningCount = rows.length > 0 ? Number(rows[0].slow_running_count) : slowWorkCapacity;
  return {
    jobs: rows.map((r) => ({ jobId: r.job_id, isSlow: Number(r.is_slow) === 1 })),
    availableSlowWorkSlots: Math.max(0, slowWorkCapacity - slowRunningCount),
  };
}

/**
 * Deletes all of the rows for the given job from the user_work table.
 * delete from user_work where job_id = $job_id
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @returns the number of rows deleted
 */
export async function deleteUserWorkForJob(tx: Transaction, jobID: string): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ job_id: jobID })
    .del();
  return numDeleted;
}

/**
 * Deletes all of the rows for the given job and service ID from the user_work table.
 * delete from user_work where job_id = $job_id and service_id = $service_id
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @returns the number of rows deleted
 */
export async function deleteUserWorkForJobAndService(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .del();
  return numDeleted;
}

/**
 * Adds one to the ready_count for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param additionalReadyCount - additional number of items that are now ready - defaults to 1
 * @param serviceID - The ID of the service
 */
export async function incrementReadyCount(
  tx: Transaction, jobID: string, serviceID: string, additionalReadyCount = 1,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .increment('ready_count', additionalReadyCount);
}

/**
 * Get the running_count or ready_count for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @param readyOrRunning - The work item state (ready or running)
 */
export async function getCount(
  tx: Transaction, jobID: string, serviceID: string, readyOrRunning: 'ready' | 'running',
): Promise<number> {
  const record = await tx(UserWork.table)
    .select(`${readyOrRunning}_count`)
    .where({ job_id: jobID, service_id: serviceID })
    .first();
  return record[`${readyOrRunning}_count`];
}

/**
 * Sets the ready_count to 0 for the given jobID.
 * Optionally restricts the update to a specific serviceID.
 *
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - Optional service ID
 */
export async function setReadyCountToZero(
  tx: Transaction,
  jobID: string,
  serviceID = '',
): Promise<void> {
  const query = tx(UserWork.table)
    .where({ job_id: jobID });

  if (serviceID) {
    query.andWhere({ service_id: serviceID });
  }

  await query.update('ready_count', 0);
}

/**
 * Sets the ready and running count to 0 for the given jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function setReadyAndRunningCountToZero(tx: Transaction, jobID: string): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID })
    .update('ready_count', 0)
    .update('running_count', 0);
}

/**
 * Populates the user_work table for the given jobID from the work_items table.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function populateUserWorkForJobId(tx: Transaction, jobID: string): Promise<void> {
  let now = 'datetime(\'now\')';
  if (db.client.config.client === 'pg') {
    now = 'now()';
  }

  const sql = 'INSERT INTO user_work(ready_count, running_count, last_worked, service_id, '
  + 'job_id, username, is_async, "createdAt", "updatedAt") '
  + 'SELECT count(1) filter (WHERE i.status = \'ready\' AND "i"."serviceID" = "ws"."serviceID" AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as ready_count, '
  + 'count(1) filter (WHERE i.status = \'running\' AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as running_count, '
  + `"j"."updatedAt", ws."serviceID", "ws"."jobID", j.username, "j"."isAsync", ${now}, ${now} `
  + 'FROM workflow_steps ws '
  + 'JOIN jobs j on "ws"."jobID" = "j"."jobID" '
  + 'LEFT JOIN work_items i on "ws"."jobID" = "i"."jobID" AND "i"."jobID" = "j"."jobID" '
  + 'WHERE j.status not in (\'successful\', \'complete_with_errors\', \'failed\', \'canceled\') '
  + `AND "j"."jobID" = '${jobID}' `
  + 'AND ws.is_complete IS NOT TRUE '
  + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
  + 'ORDER BY "j"."updatedAt" asc';
  await tx.raw(sql);
}

/**
 * Sets the ready_count or running_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param readyOrRunning - The work item state (ready or running)
 */
export async function recalculateCount(tx: Transaction, jobID: string, readyOrRunning: 'ready' | 'running'): Promise<void> {
  const rows = await tx(UserWork.table)
    .select(['id', 'service_id'])
    .where({ job_id: jobID });

  // Job was paused at initial transition and populating of user_work table
  if (rows.length === 0) {
    await populateUserWorkForJobId(tx, jobID);
  } else {
    for (const row of rows) {
      const readyOrRunningCountRow = await tx(WorkItem.table)
        .count()
        .where({ jobID, serviceID: row.service_id, status: readyOrRunning })
        .first();

      let key = 'count(*)';
      if (db.client.config.client === 'pg') {
        key = 'count';
      }
      await tx(UserWork.table)
        .where({ id: row.id })
        .update(`${readyOrRunning}_count`, readyOrRunningCountRow[key]);
    }
  }
}

/**
 * Sets the ready_count and running_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function recalculateCounts(tx: Transaction, jobID: string): Promise<void> {
  await recalculateCount(tx, jobID, 'ready');
  await recalculateCount(tx, jobID, 'running');
}

/**
 * Sets the ready_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function recalculateReadyCount(tx: Transaction, jobID: string): Promise<void> {
  await recalculateCount(tx, jobID, 'ready');
}

/**
 * Adds one to the running_count and subtracts one from the ready_count for the given
 * jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function incrementRunningAndDecrementReadyCounts(
  tx: Transaction, jobID: string, serviceID: string, count = 1,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .update({
      ready_count: tx.raw(`CASE WHEN ready_count >= ${count} THEN ready_count - ${count} ELSE 0 END`),
      last_worked: new Date(),
    })
    .increment('running_count', count);
}

/**
 * Adds one to the ready_count and subtracts one from the running_count for the given
 * jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function incrementReadyAndDecrementRunningCounts(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .increment('ready_count')
    .update({
      running_count: tx.raw('CASE WHEN running_count > 0 THEN running_count - 1 ELSE 0 END'),
    });
}

/**
 * Decrements the running_count by one for the given jobID and serviceID. When the duration of a
 * just-completed work item is provided, also folds it into the cumulative mean average_duration
 * (in ms) and increments completed_count. This is on the hot work item update path, so it's all
 * done in a single UPDATE (using the row's pre-update values in the SET expressions) to avoid
 * extra database round trips and repeated row locking.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @param completedDurationMs - The duration (in ms) of the just-completed work item, if any
 */
export async function decrementRunningCount(
  tx: Transaction, jobID: string, serviceID: string, completedDurationMs?: number,
): Promise<void> {
  const updates: { [column: string]: Knex.Raw } = {
    running_count: tx.raw('CASE WHEN running_count > 0 THEN running_count - 1 ELSE 0 END'),
  };
  if (completedDurationMs !== undefined && completedDurationMs !== null) {
    // Cast to BIGINT before multiplying - with integer columns postgres overflows 32 bits once
    // average_duration * completed_count passes ~2.1 billion (e.g. 36,000 completions at 60s)
    updates.average_duration = tx.raw(
      'ROUND((CAST(COALESCE(average_duration, 0) AS BIGINT) * completed_count + ?) * 1.0 / (completed_count + 1))',
      [Math.round(completedDurationMs)],
    );
    updates.completed_count = tx.raw('completed_count + 1');
  }
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .update(updates);
}

/**
 * Deletes any rows with 0 running_count and 0 ready_count
 * @param tx - The database transaction
 * @returns the number of rows deleted
 */
export async function deleteOrphanedRows(tx: Transaction): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ ready_count: 0, running_count: 0 })
    .del();
  return numDeleted;
}

/**
 * Populates the user_work table from scratch using the work_items table.
 * @param tx - The database transaction
 */
export async function populateUserWorkFromWorkItems(tx: Transaction): Promise<void> {
  let now = 'datetime(\'now\')';
  if (db.client.config.client === 'pg') {
    now = 'now()';
  }
  const sql = 'INSERT INTO user_work(ready_count, running_count, last_worked, service_id, '
    + 'job_id, username, is_async, "createdAt", "updatedAt") '
    + 'SELECT count(1) filter (WHERE i.status = \'ready\' AND "i"."serviceID" = "ws"."serviceID" AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as ready_count, '
    + 'count(1) filter (WHERE i.status = \'running\' AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as running_count, '
    + `"j"."updatedAt", ws."serviceID", "ws"."jobID", j.username, "j"."isAsync", ${now}, ${now} `
    + 'FROM workflow_steps ws '
    + 'JOIN jobs j on "ws"."jobID" = "j"."jobID" '
    + 'LEFT JOIN work_items i on "ws"."jobID" = "i"."jobID" AND "i"."jobID" = "j"."jobID" '
    + 'WHERE j.status not in (\'successful\', \'complete_with_errors\', \'failed\', \'canceled\') '
    + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
    + 'ORDER BY "j"."updatedAt" asc';
  await tx.raw(sql);
}

/**
 * Get the aggregated number of work items in the system grouped by service
 * @param tx - The database transaction
 * @returns the number of work items in the system grouped by service
 */
export async function getCountsByService(
  tx: Transaction,
): Promise<{ [service: string]: { queued: number } }> {
  const results = await tx(UserWork.table)
    .select(
      'service_id',
      tx.raw('SUM(ready_count) + SUM(running_count) AS queued'),
    )
    .groupBy('service_id')
    .orderBy('queued', 'desc');

  return Object.fromEntries(
    results.map(r => [
      r.service_id,
      { queued: Number(r.queued) },
    ]),
  );
}
