//
// The fast-lane-reserve policy (harmony-2413) with fixes for the problems the simulator found
// with it. The reserve itself is unchanged - slow work may never use more than
// (1 - FAST_LANE_RESERVE_FRACTION) of a service's pods, even when nothing else is waiting. That
// is by design (Harmony has seen slow jobs take every pod and leave arriving fast jobs unworked),
// so pods the reserve leaves idle are an accepted cost, not something for this policy to fix.
// Because fix 1 below stops slow work getting past the cap before it is measured, the reserve
// holds from the start, so expect more such idle time than with fast-lane-reserve. The fixes:
//
// 1. Unmeasured work is limited. A (job, service) with no completed work item yet may only have
//    ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT work items running, so a new job whose work items turn
//    out to be slow can't fill the service before anyone knows it's slow. Beyond that limit,
//    all unmeasured work on the service together may run up to
//    ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION of the slow work capacity, while the capacity has
//    room: unmeasured work might turn out to be slow, so it shares the capacity with the work
//    known to be slow and never takes the reserve, and sharing the allowance stops a few new
//    jobs from taking every slow slot between them.
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
// 6. Slow work yields to fair share while fast work waits. While another user has fast work
//    ready for the service, a user's slow work only gets new work items while that user has
//    fewer than their max-min fair share of the service's pods running. Without this, a slow
//    user refills every pod they free up to the slow work capacity, so backed up fast users
//    share only the reserve. Nothing running is interrupted - the slow user drops to their
//    share as their work items finish - and when no fast work is waiting, slow work can use up
//    to the capacity as before.
// 7. Long-running work is slow before it finishes. A work item that has been running longer
//    than the threshold will take longer than the threshold, so its (job, service) is treated
//    as slow from then on - without waiting for a work item to complete. This caps the cost
//    of fix 1's limit at the threshold rather than the first work item's duration, and
//    notices a job that has slowed down (story 09) sooner than the moving average does. It
//    only ever shows that work is slow: showing it's fast still takes completed work items.
//    The current attempt's start time is used, so queue time and failed attempts don't count;
//    a stuck work item looks slow until the work-failer times it out.
//
// Each fix can be switched off (see settings() below); with all seven off the policy makes
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
  // all unmeasured work on the service together may run up to this fraction of the slow work
  // capacity, sharing the capacity with slow work (each (job, service) can always run
  // unmeasuredLimit); 0 = just unmeasuredLimit
  unmeasuredFraction: number;
  // weight of the newest work item in the moving average; 0 = lifetime mean (fast-lane-reserve)
  ewmaAlpha: number;
  // true = unmeasured work counts as the service's mean measured duration when ranking users
  serviceEstimate: boolean;
  // expected duration of unmeasured work when there's nothing better (fast-lane-reserve: 1 hour)
  unmeasuredDefaultMs: number;
  splitByUser: boolean;
  useServiceDuration: boolean;
  // true = slow work is held to its user's fair share while other users' fast work waits
  slowFairShare: boolean;
  // true = a (job, service) is also slow while one of its work items has been running longer
  // than the threshold
  runningEvidence: boolean;
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
    unmeasuredFraction: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION ?? 0.5),
    ewmaAlpha: Number(env.ADAPTIVE_FAST_LANE_EWMA_ALPHA ?? 0.2),
    serviceEstimate: (env.ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE ?? 'service') === 'service',
    unmeasuredDefaultMs: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS ?? 3_600_000),
    splitByUser: envBoolean('ADAPTIVE_FAST_LANE_SPLIT_BY_USER', true),
    useServiceDuration: envBoolean('ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION', true),
    slowFairShare: envBoolean('ADAPTIVE_FAST_LANE_SLOW_FAIR_SHARE', true),
    runningEvidence: envBoolean('ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE', true),
  };
}

// The CTEs that classify each (job, service) of the service as slow or not, shared by every
// query that needs to know what's slow so they all agree: slow if its measured duration is
// over the threshold or (fix 7) one of its work items has been running for longer than the
// threshold in its current attempt. A running item's startedAt is when a pod took it off the
// queue, and is reset by a retry, so time spent queued or in failed attempts doesn't count.
// Uses the bindings from classificationBindings.
const CLASSIFIED_CTES = `
    LongRunning AS (
      SELECT DISTINCT "jobID" AS job_id
      FROM work_items
      WHERE :runningEvidence = 1
        AND "serviceID" = :serviceID
        AND status = 'running'
        AND "startedAt" < :longRunningSince
    ),
    Classified AS (
      SELECT
        uw.*,
        CASE WHEN uw.average_duration > :threshold OR uw.job_id IN (SELECT job_id FROM LongRunning)
          THEN 1 ELSE 0 END AS slow
      FROM user_work uw
      WHERE uw.service_id = :serviceID
    )`;

/**
 * The bindings CLASSIFIED_CTES uses.
 *
 * @param serviceID - The service ID
 * @param s - the policy settings
 * @returns the bindings
 */
function classificationBindings(serviceID: string, s: Settings): Record<string, string | number | Date> {
  return {
    serviceID,
    threshold: s.slowWorkThresholdMs,
    runningEvidence: s.runningEvidence ? 1 : 0,
    longRunningSince: new Date(Date.now() - s.slowWorkThresholdMs),
  };
}

/**
 * Returns the rows of a raw query's result.
 *
 * @param results - the result of tx.raw()
 * @returns the rows
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawRows(results: any): any[] {
  // pg's tx.raw() returns { rows: [...] }; sqlite's (test-only) returns the row array directly.
  return db.client.config.client === 'pg' ? (results.rows || []) : results;
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

/**
 * Computes the max-min fair allocation of a capacity among users with the given demands: every
 * user gets an equal share, except that users who want less than that get what they want and
 * the remainder is shared among the rest.
 *
 * @param demands - each user's demand
 * @param capacity - the total capacity
 * @returns each user's fair share
 */
function maxMinFairShares(demands: Record<string, number>, capacity: number): Record<string, number> {
  const shares: Record<string, number> = {};
  let remaining = capacity;
  let users = Object.keys(demands).filter((u) => demands[u] > 0);
  while (users.length > 0 && remaining > 1e-9) {
    const equal = remaining / users.length;
    const satisfied = users.filter((u) => demands[u] - (shares[u] || 0) <= equal);
    if (satisfied.length === 0) {
      for (const u of users) shares[u] = (shares[u] || 0) + equal;
      remaining = 0;
    } else {
      for (const u of satisfied) {
        remaining -= demands[u] - (shares[u] || 0);
        shares[u] = demands[u];
      }
      users = users.filter((u) => !satisfied.includes(u));
    }
  }
  return shares;
}

/**
 * For fix 6: how many more work items each user's slow work may take in this scheduling pass.
 * While another user has fast work ready, a user is held to their max-min fair share of the
 * service's pods (counting all of their running work on the service); otherwise there is no
 * limit beyond the slow work capacity.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param podCount - the number of pods running the service
 * @param s - the policy settings
 * @returns the limit per user, for users with work for the service
 */
async function slowWorkLimits(
  tx: Transaction, serviceID: string, podCount: number, s: Settings,
): Promise<Record<string, number>> {
  // unmeasured work counts as fast unless it's been running too long, as when classifying jobs
  const rows = rawRows(await tx.raw(`
    WITH ${CLASSIFIED_CTES}
    SELECT
      username,
      SUM(running_count) AS running,
      SUM(ready_count) AS ready,
      SUM(CASE WHEN slow = 0 THEN ready_count ELSE 0 END) AS fast_ready
    FROM Classified
    GROUP BY username
  `, classificationBindings(serviceID, s)));
  const loads = rows.map((r) => ({
    user: r.username as string,
    running: Number(r.running) || 0,
    ready: Number(r.ready) || 0,
    fastReady: Number(r.fast_ready) || 0,
  }));
  const shares = maxMinFairShares(Object.fromEntries(loads.map((l) => [l.user, l.running + l.ready])), podCount);
  const limits: Record<string, number> = {};
  for (const load of loads) {
    const fastWaiting = loads.some((other) => other.user !== load.user && other.fastReady > 0);
    // a fractional share rounds up, so a slow user isn't held below it
    limits[load.user] = fastWaiting ? Math.max(0, Math.ceil((shares[load.user] ?? 0) - 1e-9) - load.running) : Infinity;
  }
  return limits;
}

/**
 * How many work items all unmeasured work on the service may run together beyond each (job,
 * service)'s unmeasured limit: the unmeasured fraction of the slow work capacity, or the limit
 * if that's more.
 *
 * @param s - the policy settings
 * @param slowWorkCapacity - the most slow work items that may run on the service
 * @returns the allowance
 */
function unmeasuredAllowance(s: Settings, slowWorkCapacity: number): number {
  return Math.max(s.unmeasuredLimit, Math.floor(s.unmeasuredFraction * slowWorkCapacity));
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
 * @returns the jobs, the number of slow work items currently running, and the number of
 * unmeasured work items currently running
 */
async function getNextJobs(
  tx: Transaction, serviceID: string, batchSize: number, slowWorkCapacity: number, s: Settings,
): Promise<{ jobs: NextJob[]; slowRunningCount: number; unmeasuredRunningCount: number }> {
  // sqlite (test-only) doesn't support SKIP LOCKED; it's only needed for real concurrent
  // scheduler pods, which only run against postgres.
  const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

  const sql = `
    WITH ${CLASSIFIED_CTES},
    SlowInUse AS (
      SELECT COALESCE(SUM(running_count), 0) AS slow_running_count
      FROM Classified
      WHERE slow = 1
    ),
    ServiceEstimate AS (
      SELECT service_id, AVG(average_duration) AS estimate
      FROM user_work
      WHERE average_duration IS NOT NULL
      GROUP BY service_id
    ),
    UnmeasuredInUse AS (
      SELECT COALESCE(SUM(running_count), 0) AS unmeasured_running_count
      FROM Classified
      WHERE average_duration IS NULL AND slow = 0
    ),
    Eligible AS (
      SELECT
        uw.job_id,
        uw.last_worked,
        uw.username,
        uw.is_async,
        uw.slow AS is_slow,
        CASE WHEN uw.average_duration IS NULL AND uw.slow = 0 THEN uw.running_count ELSE NULL END AS unmeasured_running
      FROM Classified uw
      CROSS JOIN SlowInUse s
      CROSS JOIN UnmeasuredInUse m
      WHERE uw.ready_count > 0
        AND (
          (uw.slow = 1 AND s.slow_running_count < :capacity)
          OR (uw.slow = 0 AND uw.average_duration IS NOT NULL)
          OR (uw.slow = 0 AND uw.average_duration IS NULL AND :unmeasuredLimit > 0
            AND uw.running_count < :unmeasuredLimit)
          OR (uw.slow = 0 AND uw.average_duration IS NULL AND :unmeasuredLimit > 0
            AND m.unmeasured_running_count < :unmeasuredAllowance
            AND s.slow_running_count + m.unmeasured_running_count < :capacity)
          OR (uw.slow = 0 AND uw.average_duration IS NULL AND :unmeasuredLimit <= 0
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

  const bindings = classificationBindings(serviceID, s);
  const [results, slowResults, unmeasuredResults] = await Promise.all([
    tx.raw(sql, {
      ...bindings,
      capacity: slowWorkCapacity,
      unmeasuredLimit: s.unmeasuredLimit,
      unmeasuredAllowance: unmeasuredAllowance(s, slowWorkCapacity),
      serviceEstimate: s.serviceEstimate ? 1 : 0,
      unmeasuredDefault: s.unmeasuredDefaultMs,
      batchSize,
    }),
    tx.raw(`WITH ${CLASSIFIED_CTES} SELECT SUM(running_count) AS n FROM Classified WHERE slow = 1`, bindings),
    tx.raw(`WITH ${CLASSIFIED_CTES} SELECT SUM(running_count) AS n FROM Classified WHERE average_duration IS NULL AND slow = 0`, bindings),
  ]);
  const slowRow = { slowRunningCount: rawRows(slowResults)[0]?.n };
  const unmeasuredRow = { unmeasuredRunningCount: rawRows(unmeasuredResults)[0]?.n };

  const rows = rawRows(results);
  return {
    jobs: rows.map((r) => ({
      jobId: r.job_id,
      username: r.username,
      isSlow: Number(r.is_slow) === 1,
      unmeasuredRunning: r.unmeasured_running === null || r.unmeasured_running === undefined
        ? null : Number(r.unmeasured_running),
    })),
    slowRunningCount: Number(slowRow?.slowRunningCount) || 0,
    unmeasuredRunningCount: Number(unmeasuredRow?.unmeasuredRunningCount) || 0,
  };
}

export const adaptiveFastLanePolicy: FairQueueingPolicy = {
  name: 'adaptive-fast-lane',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const s = settings();
    const podCount = context.servicePodCount ?? 0;
    const slowWorkCapacity = getSlowWorkCapacity(podCount, s.fastLaneReserveFraction);
    const { jobs, slowRunningCount, unmeasuredRunningCount } = await getNextJobs(
      tx, serviceID, batchSize, slowWorkCapacity, s);
    let remainingSlowWorkSlots = Math.max(0, slowWorkCapacity - slowRunningCount);
    // unmeasured work beyond the unmeasured limit might turn out to be slow, so it shares the
    // slow work capacity with the work known to be slow
    let remainingUnmeasuredSlots = Math.max(0, slowWorkCapacity - slowRunningCount - unmeasuredRunningCount);
    // what's left of the allowance for all unmeasured work together
    let remainingSharedAllowance = unmeasuredAllowance(s, slowWorkCapacity) - unmeasuredRunningCount;
    const slowLimits = s.slowFairShare && podCount > 0 && jobs.some((j) => j.isSlow)
      ? await slowWorkLimits(tx, serviceID, podCount, s)
      : {};

    // takes up to workSize work items from a job, within the slow work, fair share and
    // unmeasured limits
    const take = async (job: NextJob, workSize: number): Promise<number> => {
      let size = workSize;
      if (job.isSlow) size = Math.min(size, remainingSlowWorkSlots, slowLimits[job.username] ?? Infinity);
      if (s.unmeasuredLimit > 0 && job.unmeasuredRunning !== null) {
        const limit = s.unmeasuredLimit - job.unmeasuredRunning;
        // beyond the limit, what's left of the shared allowance while the slow work capacity has room
        size = Math.min(size, Math.max(limit, Math.min(remainingSharedAllowance, remainingUnmeasuredSlots)));
      }
      if (size <= 0) return 0;
      const numTaken = await takeWorkItems(job.jobId, size);
      if (job.unmeasuredRunning !== null) {
        remainingUnmeasuredSlots -= numTaken;
        remainingSharedAllowance -= numTaken;
      }
      if (job.isSlow) remainingSlowWorkSlots -= numTaken;
      // the user's fast work counts towards their share too
      if (slowLimits[job.username] !== undefined) slowLimits[job.username] -= numTaken;
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
 * Records the fast lane state plus how many unmeasured work items are running and (fix 7) how
 * many (job, service)s are slow only because of a long-running work item. The fast lane state's
 * slowJobs counts only those slow by measured duration.
 *
 * @param tx - a database connection
 * @param serviceID - the service ID
 * @param servicePodCount - the number of pods for the service
 * @returns the sample values
 */
export async function sampleAdaptiveFastLane(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<Record<string, number>> {
  const s = settings();
  const values = await sampleFastLaneReserve(tx, serviceID, servicePodCount);
  const row = await tx(UserWork.table)
    .where('service_id', serviceID)
    .whereNull('average_duration')
    .sum({ n: 'running_count' })
    .first();
  const longRunning = rawRows(await tx.raw(`
    WITH ${CLASSIFIED_CTES}
    SELECT COUNT(*) AS n FROM Classified
    WHERE slow = 1 AND (average_duration IS NULL OR average_duration <= :threshold)
  `, classificationBindings(serviceID, s)));
  return { ...values, unmeasuredRunning: Number(row?.n) || 0, longRunningJobs: Number(longRunning[0]?.n) || 0 };
}
