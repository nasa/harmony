//
// The fair queueing algorithm from the harmony-2413 branch (as of 116ffecd7), ported to the
// FairQueueingPolicy interface so it can be compared against the baseline:
//
// - users are ranked within each round by the expected runtime of their in-progress work
//   (running work items times the measured mean duration, across all services) instead of by
//   how recently they were worked
// - a user's synchronous jobs rank ahead of their asynchronous ones
// - a "fast lane reserve": work for a (job, service) whose mean work item duration is above
//   SLOW_WORK_THRESHOLD_MS may only occupy (1 - FAST_LANE_RESERVE_FRACTION) of the service's pods
//
// The SQL and the batch splitting loop are copied from user-work.ts / work-item-polling.ts on
// that branch with as few changes as possible. The one structural difference is that the
// branch folded the duration bookkeeping into decrementRunningCount's UPDATE, whereas here it is
// a separate UPDATE in onWorkItemCompleted (the result is the same; it costs one extra statement
// per completed work item). Requires the average_duration and completed_count columns on
// user_work (db/migrations/20261009092416_add_average_duration_to_user_work.js).
//

import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import UserWork from '../../../../services/harmony/app/models/user-work';
import db, { Transaction } from '../../../../services/harmony/app/util/db';

// Expected runtime (in ms) assumed for in-progress work with no measured average_duration yet,
// used only for ranking users by total expected runtime
const DEFAULT_EXPECTED_DURATION_MS = 60 * 60 * 1000;

// Expected runtime (in ms) of a user_work row's running work items, with one binding for the
// default duration. Cast to BIGINT before multiplying - with integer columns postgres overflows
// 32 bits once running_count * duration passes ~2.1 billion (e.g. 597 unmeasured running items).
const EXPECTED_RUNTIME_SQL = 'CAST(running_count AS BIGINT) * COALESCE(average_duration, ?)';

/**
 * Returns the maximum number of work items for a service that may be running at once for jobs
 * classified as "slow", i.e. the share of the service's capacity not held back by
 * `fastLaneReserveFraction`. Always at least 1 so slow work can make progress on a service
 * with very few pods.
 *
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @param fastLaneReserveFraction - The fraction of the service's capacity reserved for fast work
 * @returns the maximum number of slow work items that may be running for the service
 */
export function getSlowWorkCapacity(servicePodCount: number, fastLaneReserveFraction: number): number {
  // the small epsilon guards against floating point products like 48.99999999999999
  return Math.max(1, Math.floor(servicePodCount * (1 - fastLaneReserveFraction) + 1e-9));
}

/**
 * Returns the number of work items currently running for the service's slow (job, service) rows.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param slowWorkThresholdMs - Average work item duration (in ms) above which a job/service is slow
 * @returns the number of slow work items in flight
 */
async function getSlowRunningCount(tx: Transaction, serviceID: string, slowWorkThresholdMs: number): Promise<number> {
  const row = await tx(UserWork.table)
    .where('service_id', serviceID)
    .where('average_duration', '>', slowWorkThresholdMs)
    .sum({ slowRunningCount: 'running_count' })
    .first();
  return Number(row?.slowRunningCount) || 0;
}

/**
 * Return a randomly shuffled list of the given list (Fisher-Yates), as in work-item-polling.ts.
 *
 * @param array - the given list to shuffle
 * @returns The randomly shuffled list of the original list
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

interface NextJobs {
  jobs: { jobId: string; isSlow: boolean }[];
  availableSlowWorkSlots: number;
}

/**
 * The branch's getNextJobIds: the jobs to work in fair queueing priority order, flagged with
 * whether they are slow, plus the remaining slow work capacity.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param batchSize - The batch size
 * @param servicePodCount - The number of pods currently running for the service (its capacity)
 * @param slowWorkThresholdMs - Average work item duration (in ms) above which a job/service is slow
 * @param fastLaneReserveFraction - The fraction of the service's capacity reserved for fast work
 * @returns The list of jobs in fair queuing priority and the number of available slow work slots
 */
async function getNextJobIds(
  tx: Transaction,
  serviceID: string,
  batchSize: number,
  servicePodCount: number,
  slowWorkThresholdMs: number,
  fastLaneReserveFraction: number,
): Promise<NextJobs> {
  const slowWorkCapacity = getSlowWorkCapacity(servicePodCount, fastLaneReserveFraction);
  // sqlite (test-only) doesn't support SKIP LOCKED; it's only needed for real concurrent
  // scheduler pods, which only run against postgres.
  const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

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
        e.is_slow,
        ROW_NUMBER() OVER (
          PARTITION BY e.username
          ORDER BY e.is_async ASC, e.last_worked ASC, e.job_id ASC
        ) AS user_row_num
      FROM Eligible e
    ),
    Interleaved AS (
      SELECT
        R.job_id,
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
    ORDER BY i.overall_row_num
    ${lockClause}
  `;

  const [results, slowRunningCount] = await Promise.all([
    tx.raw(sql, [
      serviceID,
      slowWorkThresholdMs,
      slowWorkThresholdMs,
      serviceID,
      slowWorkCapacity,
      slowWorkThresholdMs,
      DEFAULT_EXPECTED_DURATION_MS,
      serviceID,
      batchSize,
    ]),
    // the main query above only reports slow_running_count on rows it actually returns, so an
    // empty result (no ready jobs at all, vs. every ready job being slow and filtered out) can't
    // be told apart from it alone - get the true count directly instead of guessing.
    getSlowRunningCount(tx, serviceID, slowWorkThresholdMs),
  ]);

  // pg's tx.raw() returns { rows: [...] }; sqlite's (test-only) returns the row array directly.
  const rows = db.client.config.client === 'pg' ? (results.rows || []) : results;
  return {
    jobs: rows.map((r) => ({ jobId: r.job_id, isSlow: Number(r.is_slow) === 1 })),
    availableSlowWorkSlots: Math.max(0, slowWorkCapacity - slowRunningCount),
  };
}

/**
 * Reads the policy's settings from the environment, with the branch's defaults.
 *
 * @returns the slow work threshold and fast lane reserve fraction
 */
function settings(): { slowWorkThresholdMs: number; fastLaneReserveFraction: number } {
  return {
    slowWorkThresholdMs: Number(process.env.SLOW_WORK_THRESHOLD_MS ?? 600_000),
    fastLaneReserveFraction: Number(process.env.FAST_LANE_RESERVE_FRACTION ?? 0.3),
  };
}

export const fastLaneReservePolicy: FairQueueingPolicy = {
  name: 'fast-lane-reserve',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const { slowWorkThresholdMs, fastLaneReserveFraction } = settings();
    const servicePodCount = context.servicePodCount ?? 0;
    const { jobs, availableSlowWorkSlots } = await getNextJobIds(
      tx, serviceID, batchSize, servicePodCount, slowWorkThresholdMs, fastLaneReserveFraction);
    let remainingSlowWorkSlots = availableSlowWorkSlots;
    const shuffledJobs = shuffleArray(jobs);

    let remainingNumOfJobs = jobs.length;
    let remainingBatchSize = batchSize;

    for (const { jobId, isSlow } of shuffledJobs) {
      let workSize =
        remainingNumOfJobs > 0
          ? Math.ceil(remainingBatchSize / remainingNumOfJobs)
          : 1;

      // slow jobs share whatever is left of the service's slow work capacity
      if (isSlow) {
        workSize = Math.min(workSize, remainingSlowWorkSlots);
        if (workSize <= 0) {
          remainingNumOfJobs -= 1;
          continue;
        }
      }

      const numTaken = await takeWorkItems(jobId, workSize);
      if (isSlow) {
        remainingSlowWorkSlots -= numTaken;
      }

      remainingNumOfJobs -= 1;
      remainingBatchSize -= numTaken;
    }
  },

  async onWorkItemCompleted(tx, workItem): Promise<void> {
    // Cast to BIGINT before multiplying - with integer columns postgres overflows 32 bits once
    // average_duration * completed_count passes ~2.1 billion (e.g. 36,000 completions at 60s)
    await tx(UserWork.table)
      .where({ job_id: workItem.jobID, service_id: workItem.serviceID })
      .update({
        average_duration: tx.raw(
          'ROUND((CAST(COALESCE(average_duration, 0) AS BIGINT) * completed_count + ?) * 1.0 / (completed_count + 1))',
          [Math.round(workItem.durationMs)],
        ),
        completed_count: tx.raw('completed_count + 1'),
      });
  },
};

/**
 * Records how much of the service's slow work capacity is in use.
 *
 * @param tx - a database connection
 * @param serviceID - the service ID
 * @param servicePodCount - the number of pods for the service
 * @returns the sample values
 */
export async function sampleFastLaneReserve(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<Record<string, number>> {
  const { slowWorkThresholdMs, fastLaneReserveFraction } = settings();
  const slowRunning = await getSlowRunningCount(tx, serviceID, slowWorkThresholdMs);
  const slowCapacity = getSlowWorkCapacity(servicePodCount, fastLaneReserveFraction);
  const slowJobs = await tx(UserWork.table)
    .where('service_id', serviceID)
    .where('average_duration', '>', slowWorkThresholdMs)
    .count({ n: '*' })
    .first();
  return {
    slowRunning,
    slowCapacity,
    fastLaneOnly: slowRunning >= slowCapacity ? 1 : 0,
    slowJobs: Number(slowJobs?.n) || 0,
  };
}
