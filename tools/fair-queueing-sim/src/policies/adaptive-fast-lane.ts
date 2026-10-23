//
// The fast-lane-reserve policy (harmony-2413) with fixes for the problems the simulator found
// with it. The reserve itself is unchanged - slow work may never use more than
// (1 - FAST_LANE_RESERVE_FRACTION) of a service's pods - but:
//
// 1. Unmeasured work is limited. A (job, service) with no completed work item yet may only have
//    ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT work items running, so a new job whose work items turn
//    out to be slow can't fill the service before anyone knows it's slow.
// 2. Durations track recent work. The measured duration is an exponentially weighted moving
//    average (weight ADAPTIVE_FAST_LANE_EWMA_ALPHA on the newest work item) rather than the
//    mean over the job's lifetime, so a job whose work items get slower part way through is
//    reclassified within a few work items.
// 3. New jobs get a realistic expected runtime. When ranking users, running work items of a
//    (job, service) that hasn't been measured yet count as the service's current mean measured
//    duration (over other jobs) rather than a flat hour, so new jobs aren't pushed to the back.
// 4. Batches are split per user. Each scheduling batch is first split evenly between users, then
//    between each user's jobs, so a user with many jobs doesn't get more of the service than a
//    user with one.
// 5. Durations exclude queue wait. The duration used is the one the service pod reports (how
//    long the work item actually ran), not Harmony's, which starts when the work item is queued
//    and so includes time spent waiting for a pod.
//
// Each fix can be switched off (see settings() below); with all of them off the policy makes
// exactly the same decisions as fast-lane-reserve. Uses the same average_duration and
// completed_count columns on user_work as fast-lane-reserve.
//

import { getSlowWorkCapacity, sampleFastLaneReserve } from './fast-lane-reserve';
import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import UserWork from '../../../../services/harmony/app/models/user-work';
import db, { Transaction } from '../../../../services/harmony/app/util/db';

interface Settings {
  slowWorkThresholdMs: number;
  fastLaneReserveFraction: number;
  // max running work items for an unmeasured (job, service); 0 = no limit (fast-lane-reserve)
  unmeasuredLimit: number;
  // weight of the newest work item in the moving average; 0 = lifetime mean (fast-lane-reserve)
  ewmaAlpha: number;
  // true = unmeasured work counts as the service's mean measured duration when ranking users
  serviceEstimate: boolean;
  // expected duration of unmeasured work when there's nothing better (fast-lane-reserve: 1 hour)
  unmeasuredDefaultMs: number;
  splitByUser: boolean;
  useServiceDuration: boolean;
}

/**
 * Reads a boolean environment variable.
 *
 * @param name - the variable name
 * @param defaultValue - the value if it isn't set
 * @returns the value
 */
function envBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? defaultValue : value.toLowerCase() === 'true';
}

/**
 * Reads the policy's settings from the environment.
 *
 * @returns the settings
 */
function settings(): Settings {
  const { env } = process;
  return {
    slowWorkThresholdMs: Number(env.SLOW_WORK_THRESHOLD_MS ?? 600_000),
    fastLaneReserveFraction: Number(env.FAST_LANE_RESERVE_FRACTION ?? 0.3),
    unmeasuredLimit: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT ?? 2),
    ewmaAlpha: Number(env.ADAPTIVE_FAST_LANE_EWMA_ALPHA ?? 0.2),
    serviceEstimate: (env.ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE ?? 'service') === 'service',
    unmeasuredDefaultMs: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS ?? 3_600_000),
    splitByUser: envBoolean('ADAPTIVE_FAST_LANE_SPLIT_BY_USER', true),
    useServiceDuration: envBoolean('ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION', true),
  };
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

interface NextJob {
  jobId: string;
  username: string;
  isSlow: boolean;
  // running work items if the (job, service) hasn't been measured yet, otherwise null
  unmeasuredRunning: number | null;
}

/**
 * The jobs to work in priority order: fast-lane-reserve's selection (round robin by user, users
 * ranked by the expected runtime of their in-progress work, sync before async within a user,
 * slow work excluded once the reserve is reached), plus the unmeasured work limit and the
 * service level estimate for unmeasured work.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param batchSize - The batch size
 * @param slowWorkCapacity - the most slow work items that may run on the service
 * @param s - the policy settings
 * @returns the jobs and the number of slow work items currently running
 */
async function getNextJobs(
  tx: Transaction, serviceID: string, batchSize: number, slowWorkCapacity: number, s: Settings,
): Promise<{ jobs: NextJob[]; slowRunningCount: number }> {
  // sqlite (test-only) doesn't support SKIP LOCKED; it's only needed for real concurrent
  // scheduler pods, which only run against postgres.
  const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

  const sql = `
    WITH SlowInUse AS (
      SELECT COALESCE(SUM(running_count), 0) AS slow_running_count
      FROM user_work
      WHERE service_id = :serviceID
        AND average_duration > :threshold
    ),
    ServiceEstimate AS (
      SELECT service_id, AVG(average_duration) AS estimate
      FROM user_work
      WHERE average_duration IS NOT NULL
      GROUP BY service_id
    ),
    Eligible AS (
      SELECT
        uw.job_id,
        uw.last_worked,
        uw.username,
        uw.is_async,
        CASE WHEN uw.average_duration > :threshold THEN 1 ELSE 0 END AS is_slow,
        CASE WHEN uw.average_duration IS NULL THEN uw.running_count ELSE NULL END AS unmeasured_running
      FROM user_work uw
      CROSS JOIN SlowInUse s
      WHERE uw.service_id = :serviceID
        AND uw.ready_count > 0
        AND (
          (uw.average_duration IS NOT NULL
            AND (s.slow_running_count < :capacity OR uw.average_duration <= :threshold))
          OR (uw.average_duration IS NULL AND :unmeasuredLimit > 0
            AND uw.running_count < :unmeasuredLimit)
          OR (uw.average_duration IS NULL AND :unmeasuredLimit <= 0
            AND (s.slow_running_count < :capacity OR (uw.running_count = 0 AND uw.completed_count = 0)))
        )
    ),
    UserRank AS (
      SELECT
        u.username,
        SUM(CAST(u.running_count AS BIGINT) * COALESCE(
          u.average_duration,
          CASE WHEN :serviceEstimate = 1 THEN e.estimate ELSE NULL END,
          :unmeasuredDefault)) AS expected_runtime,
        MAX(u.last_worked) AS most_recent_worked
      FROM user_work u
      LEFT JOIN ServiceEstimate e ON e.service_id = u.service_id
      WHERE u.username IN (SELECT DISTINCT username FROM Eligible)
      GROUP BY u.username
    ),
    RankedJobs AS (
      SELECT
        e.job_id,
        e.last_worked,
        e.username,
        e.is_slow,
        e.unmeasured_running,
        ROW_NUMBER() OVER (
          PARTITION BY e.username
          ORDER BY e.is_async ASC, e.last_worked ASC, e.job_id ASC
        ) AS user_row_num
      FROM Eligible e
    ),
    Interleaved AS (
      SELECT
        R.job_id,
        R.username,
        R.is_slow,
        R.unmeasured_running,
        ROW_NUMBER() OVER (
          ORDER BY R.user_row_num ASC, ur.expected_runtime ASC, ur.most_recent_worked ASC, R.last_worked ASC
        ) AS overall_row_num
      FROM RankedJobs R
      JOIN UserRank ur ON ur.username = R.username
    )
    SELECT uw.job_id, i.username, i.is_slow, i.unmeasured_running
    FROM user_work uw
    JOIN Interleaved i
      ON i.job_id = uw.job_id
    WHERE uw.service_id = :serviceID
      AND i.overall_row_num <= :batchSize
    ORDER BY i.overall_row_num
    ${lockClause}
  `;

  const [results, slowRow] = await Promise.all([
    tx.raw(sql, {
      serviceID,
      threshold: s.slowWorkThresholdMs,
      capacity: slowWorkCapacity,
      unmeasuredLimit: s.unmeasuredLimit,
      serviceEstimate: s.serviceEstimate ? 1 : 0,
      unmeasuredDefault: s.unmeasuredDefaultMs,
      batchSize,
    }),
    tx(UserWork.table)
      .where('service_id', serviceID)
      .where('average_duration', '>', s.slowWorkThresholdMs)
      .sum({ slowRunningCount: 'running_count' })
      .first(),
  ]);

  // pg's tx.raw() returns { rows: [...] }; sqlite's (test-only) returns the row array directly.
  const rows = db.client.config.client === 'pg' ? (results.rows || []) : results;
  return {
    jobs: rows.map((r) => ({
      jobId: r.job_id,
      username: r.username,
      isSlow: Number(r.is_slow) === 1,
      unmeasuredRunning: r.unmeasured_running === null || r.unmeasured_running === undefined
        ? null : Number(r.unmeasured_running),
    })),
    slowRunningCount: Number(slowRow?.slowRunningCount) || 0,
  };
}

export const adaptiveFastLanePolicy: FairQueueingPolicy = {
  name: 'adaptive-fast-lane',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const s = settings();
    const slowWorkCapacity = getSlowWorkCapacity(context.servicePodCount ?? 0, s.fastLaneReserveFraction);
    const { jobs, slowRunningCount } = await getNextJobs(tx, serviceID, batchSize, slowWorkCapacity, s);
    let remainingSlowWorkSlots = Math.max(0, slowWorkCapacity - slowRunningCount);

    // takes up to workSize work items from a job, within the slow work and unmeasured limits
    const take = async (job: NextJob, workSize: number): Promise<number> => {
      let size = workSize;
      if (job.isSlow) size = Math.min(size, remainingSlowWorkSlots);
      if (s.unmeasuredLimit > 0 && job.unmeasuredRunning !== null) {
        size = Math.min(size, s.unmeasuredLimit - job.unmeasuredRunning);
      }
      if (size <= 0) return 0;
      const numTaken = await takeWorkItems(job.jobId, size);
      if (job.isSlow) remainingSlowWorkSlots -= numTaken;
      return numTaken;
    };

    let remainingBatchSize = batchSize;
    if (!s.splitByUser) {
      // split evenly across jobs, as fast-lane-reserve does
      let remainingNumOfJobs = jobs.length;
      for (const job of shuffleArray(jobs)) {
        const workSize = remainingNumOfJobs > 0 ? Math.ceil(remainingBatchSize / remainingNumOfJobs) : 1;
        remainingBatchSize -= await take(job, workSize);
        remainingNumOfJobs -= 1;
      }
      return;
    }

    // split evenly across users, then across each user's jobs in priority order. Users are
    // shuffled for the same reason fast-lane-reserve shuffles jobs: whoever comes last can use
    // what earlier users couldn't, so that shouldn't always be the same user.
    const users = shuffleArray([...new Set(jobs.map((j) => j.username))]);
    let remainingNumOfUsers = users.length;
    for (const user of users) {
      const userJobs = jobs.filter((j) => j.username === user);
      let userBudget = Math.ceil(remainingBatchSize / remainingNumOfUsers);
      let remainingUserJobs = userJobs.length;
      for (const job of userJobs) {
        const numTaken = await take(job, Math.ceil(userBudget / remainingUserJobs));
        userBudget -= numTaken;
        remainingBatchSize -= numTaken;
        remainingUserJobs -= 1;
      }
      remainingNumOfUsers -= 1;
    }
  },

  async onWorkItemCompleted(tx, workItem): Promise<void> {
    const s = settings();
    const durationMs = Math.round(s.useServiceDuration && workItem.serviceDurationMs > 0
      ? workItem.serviceDurationMs : workItem.durationMs);
    const averageDuration = s.ewmaAlpha > 0
      // exponentially weighted moving average, starting from the first work item's duration
      ? tx.raw(
        'CASE WHEN average_duration IS NULL OR completed_count = 0 THEN ? ' +
        'ELSE ROUND(average_duration + ? * (? - average_duration)) END',
        [durationMs, s.ewmaAlpha, durationMs],
      )
      // lifetime mean, as fast-lane-reserve does (cast to BIGINT to avoid 32 bit overflow)
      : tx.raw(
        'ROUND((CAST(COALESCE(average_duration, 0) AS BIGINT) * completed_count + ?) * 1.0 / (completed_count + 1))',
        [durationMs],
      );
    await tx(UserWork.table)
      .where({ job_id: workItem.jobID, service_id: workItem.serviceID })
      .update({ average_duration: averageDuration, completed_count: tx.raw('completed_count + 1') });
  },
};

/**
 * Records the fast lane state plus how many unmeasured work items are running.
 *
 * @param tx - a database connection
 * @param serviceID - the service ID
 * @param servicePodCount - the number of pods for the service
 * @returns the sample values
 */
export async function sampleAdaptiveFastLane(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<Record<string, number>> {
  const values = await sampleFastLaneReserve(tx, serviceID, servicePodCount);
  const row = await tx(UserWork.table)
    .where('service_id', serviceID)
    .whereNull('average_duration')
    .sum({ n: 'running_count' })
    .first();
  return { ...values, unmeasuredRunning: Number(row?.n) || 0 };
}
