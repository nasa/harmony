//
// Fair share fast lane fair queueing (FAIR_QUEUEING_POLICY=fair-share-fast-lane in the
// work-scheduler): duration based fair queueing (durationBasedPolicy - see
// getNextJobIdsDurationBased in models/user-work.ts) with changes for the problems the fair
// queueing simulator (tools/fair-queueing-sim) found with it, chief among them holding every user
// to a fair share of the pods while others wait. See docs/fair-queueing.md, and
// tools/fair-queueing-sim/RESULTS.md for how it compares with slot based and duration based fair
// queueing; tools/fair-queueing-sim/POLICY-DESIGN.md has the evidence for each change (its "fix"
// numbers are given below).
//
// The fast lane reserve works as duration-based's does - slow work may never use more than
// (1 - reserve) of a service's pods, even when nothing else is waiting - but it's 10%
// (FAIR_SHARE_FAST_LANE_RESERVE_FRACTION) rather than FAST_LANE_RESERVE_FRACTION's 30%: at
// production's scale the limit on new jobs below does much of the protecting, so a smaller
// reserve still keeps sync requests within seconds when a slow user arrives first, and leaves
// fewer pods idle. Leaving pods idle when only slow work is waiting is by design (Harmony has seen
// slow jobs take every pod and leave arriving fast jobs unworked), an accepted cost, not something
// for this policy to fix. Because the limit on new jobs stops slow work getting past the cap
// before it is measured, the reserve mostly holds from the start, so expect more such idle time
// than with duration-based. Not entirely: every new (job, service) may run its first
// FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT work items whatever the capacity, so that it can be
// measured, so many new jobs at once can use some of the reserve until they're measured.
//
// The changes:
//
// - New jobs are limited until they're measured (fix 1). A (job, service) with no measured
//   duration yet may only have FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT work items running, so a new
//   job whose work items turn out to be slow can't fill the service before anyone knows it's
//   slow. Beyond that limit, all unmeasured work on the service together may run up to
//   FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION of the slow work capacity, while the capacity has
//   room: unmeasured work might turn out to be slow, so it shares the capacity with the work
//   known to be slow and never takes the reserve, and sharing the allowance stops a few new jobs
//   from taking every slow slot between them.
// - New jobs get a realistic expected runtime (fix 3). When ranking users, running work items of
//   a (job, service) that hasn't been measured yet count as the service's current mean measured
//   duration (over other jobs) rather than a flat hour, so new jobs aren't pushed to the back.
// - Batches are split per user (fix 4). Each scheduling batch is first split evenly between
//   users, then between each user's jobs, so a user with many jobs doesn't get more of the
//   service than a user with one.
// - Every user is held to their fair share while others wait (fix 6). While another user below
//   their max-min fair share of the service's pods has work ready, a user only gets new work items
//   while they have fewer than their own share running. Without this, a user whose work items
//   take minutes keeps accumulating pods while other users' pods come back within seconds, and a
//   slow user refills every pod they free up. Nothing running is interrupted - a user drops to
//   their share as their work items finish - and what's left of a batch once the users below
//   their share have taken what they can goes to everyone else, so it never leaves pods idle.
// - Long-running work is slow before it finishes (fix 7). A work item that has been running
//   longer than the threshold will take longer than the threshold, so its (job, service) is
//   treated as slow from then on - without waiting for a work item to complete: it counts against
//   the slow work capacity. It only applies to unmeasured work, and only ever shows that work is
//   slow. The current attempt's start time is used, so queue time and failed attempts don't
//   count; a stuck work item looks slow until the work-failer times it out. Such work keeps the
//   new job limits until it's measured, so being noticed only ever tightens what it may run.
// - Sync requests go first (fix 8). Someone is waiting on a sync request. Fair share never holds
//   one back - a sync request would otherwise wait behind its own user's async work once that
//   fills the user's share - though it still counts towards the share. And each batch goes to
//   sync requests before it's split between users: when a pod frees up the batch may have room
//   for only one work item, which the split could give anyone. Production limits each sync
//   request to one granule (MAX_SYNCHRONOUS_GRANULES), so a sync request takes at most one work
//   item a step - but there's no limit on sync requests in total, so many at once can fill a
//   batch before async work gets any of it (slot-based also ranks a user's sync jobs first).
//
// The queries below follow getNextJobIdsDurationBased step for step - when that function
// changes, consider changing these with it. The durations are Harmony's own (average_duration),
// including their seeding from the user's history and the failed work item fallback.
//

import type { FairQueueingPolicy, SchedulingContext } from './fair-queueing-policy';
import { maxMinFairShares } from './fair-share';
import { DEFAULT_EXPECTED_DURATION_MS, EFFECTIVE_DURATION_SQL, getSlowWorkCapacity } from '../../models/user-work';
import db, { Transaction } from '../../util/db';

export interface FairShareFastLaneSettings {
  // the fraction of a service's pods slow work may never use; null = the work-scheduler's
  // FAST_LANE_RESERVE_FRACTION (duration-based's)
  reserveFraction: number | null;
  // max running work items for an unmeasured (job, service); 0 = no limit (duration-based)
  unmeasuredLimit: number;
  // all unmeasured work on the service together may run up to this fraction of the slow work
  // capacity, sharing the capacity with slow work (each (job, service) can always run
  // unmeasuredLimit); 0 = just unmeasuredLimit
  unmeasuredFraction: number;
}

/**
 * Reads the policy's settings from the environment. They're read on every scheduling pass from
 * process.env, which the work-scheduler's env module fills from its env-defaults (where the
 * defaults below are repeated, with descriptions). The slow work threshold, and the reserve
 * fraction when FAIR_SHARE_FAST_LANE_RESERVE_FRACTION is 'scheduler', are the work-scheduler's
 * (from the scheduling context).
 *
 * @param env - the environment to read
 * @returns the settings
 * @throws Error - if a setting isn't valid: FAIR_SHARE_FAST_LANE_RESERVE_FRACTION a fraction from 0
 * to 1 or 'scheduler', FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT a whole number from 0, and
 * FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION a fraction from 0 to 1
 */
export function fairShareFastLaneSettings(env: NodeJS.ProcessEnv = process.env): FairShareFastLaneSettings {
  const read = (name: string, defaultValue: string, valid: (n: number) => boolean, expected: string): number => {
    const value = env[name] ?? defaultValue;
    const n = Number(value);
    if (value.trim() === '' || !valid(n)) throw new Error(`${name} must be ${expected}, not "${value}"`);
    return n;
  };
  const isFraction = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1;
  return {
    reserveFraction: env.FAIR_SHARE_FAST_LANE_RESERVE_FRACTION === 'scheduler'
      ? null
      : read('FAIR_SHARE_FAST_LANE_RESERVE_FRACTION', '0.1', isFraction, 'a fraction from 0 to 1, or "scheduler"'),
    unmeasuredLimit: read('FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT', '2', (n) => Number.isInteger(n) && n >= 0,
      'a whole number, 0 or more'),
    unmeasuredFraction: read('FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION', '0.5', isFraction, 'a fraction from 0 to 1'),
  };
}

/**
 * The CTEs that classify each (job, service) of the service as slow or not, shared by every
 * query that needs to know what's slow so they all agree. A (job, service)'s duration is
 * Harmony's (EFFECTIVE_DURATION_SQL: the mean of its successful work items, or of its failed ones
 * if it has no successes yet, or a duration seeded from the user's history, or NULL); it's slow
 * if that's over the threshold, or if it has no duration yet and one of its work items has been
 * running for longer than the threshold in its current attempt. A running item's startedAt is
 * when a pod took it off the queue, and is reset by a retry, so time spent queued or in failed
 * attempts doesn't count. Uses the bindings from classificationBindings.
 *
 * @returns the CTEs, for a WITH clause
 */
export function classifiedCtes(): string {
  // EFFECTIVE_DURATION_SQL's columns are user_work's, the only table in the FROM clause it's used in
  const duration = EFFECTIVE_DURATION_SQL;
  return `
    LongRunning AS (
      SELECT DISTINCT "jobID" AS job_id
      FROM work_items
      WHERE "serviceID" = :serviceID
        AND status = 'running'
        AND "startedAt" < :longRunningSince
    ),
    Classified AS (
      SELECT
        uw.*,
        ${duration} AS duration,
        CASE WHEN ${duration} > :threshold
          OR (${duration} IS NULL AND uw.job_id IN (SELECT job_id FROM LongRunning))
          THEN 1 ELSE 0 END AS slow
      FROM user_work uw
      WHERE uw.service_id = :serviceID
    )`;
}

/**
 * The bindings classifiedCtes uses.
 *
 * @param serviceID - The service ID
 * @param slowWorkThresholdMs - Duration (in ms) above which a job/service is slow
 * @returns the bindings
 */
export function classificationBindings(serviceID: string, slowWorkThresholdMs: number): Record<string, string | number | Date> {
  return {
    serviceID,
    threshold: slowWorkThresholdMs,
    longRunningSince: new Date(Date.now() - slowWorkThresholdMs),
  };
}

/**
 * Returns the rows of a raw query's result.
 *
 * @param results - the result of tx.raw()
 * @returns the rows
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawRows(results: any): any[] {
  // pg's tx.raw() returns { rows: [...] }; sqlite's (test-only) returns the row array directly.
  return db.client.config.client === 'pg' ? (results.rows || []) : results;
}

/**
 * A username column, compared with the "C" collation on postgres as user-work.ts does (see
 * usernameColumn there).
 *
 * @param table - the table alias
 * @returns the SQL expression
 */
function usernameColumn(table: string): string {
  return db.client.config.client === 'pg' ? `${table}.username COLLATE "C"` : `${table}.username`;
}

interface SlowWorkCounts {
  // running work items of slow (job, service)s
  slowRunningCount: number;
  // slow (job, service)s with ready work items
  slowReadyCount: number;
  // running work items of unmeasured (job, service)s that aren't slow
  unmeasuredRunningCount: number;
  // running work items of unmeasured (job, service)s that are slow because one has been running
  // too long
  unmeasuredSlowRunningCount: number;
}

/**
 * Counts the service's slow and unmeasured work, as getSlowWorkCounts in user-work.ts does.
 *
 * @param tx - The database transaction
 * @param bindings - the classification bindings
 * @returns the counts
 */
async function getSlowWorkCounts(tx: Transaction, bindings: Record<string, string | number | Date>): Promise<SlowWorkCounts> {
  const [row] = rawRows(await tx.raw(`
    WITH ${classifiedCtes()}
    SELECT
      SUM(CASE WHEN slow = 1 THEN running_count ELSE 0 END) AS slow_running,
      COUNT(CASE WHEN slow = 1 AND ready_count > 0 THEN 1 END) AS slow_ready,
      SUM(CASE WHEN slow = 0 AND duration IS NULL THEN running_count ELSE 0 END) AS unmeasured_running,
      SUM(CASE WHEN slow = 1 AND duration IS NULL THEN running_count ELSE 0 END) AS unmeasured_slow_running
    FROM Classified
  `, bindings));
  return {
    slowRunningCount: Number(row?.slow_running) || 0,
    slowReadyCount: Number(row?.slow_ready) || 0,
    unmeasuredRunningCount: Number(row?.unmeasured_running) || 0,
    unmeasuredSlowRunningCount: Number(row?.unmeasured_slow_running) || 0,
  };
}

/**
 * Return a randomly shuffled list of the given list (Fisher-Yates), as fair-queueing-policy.ts
 * does.
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
 * For fair share: how many more work items each user may take in this scheduling pass. While
 * another user below their max-min fair share of the service's pods has work ready, a user is
 * held to their own share (counting all of their running work on the service); otherwise there
 * is no limit beyond the slow work capacity.
 *
 * @param tx - The database transaction
 * @param bindings - the classification bindings
 * @param podCount - the number of pods running the service
 * @returns for users with work for the service, the limit, and their headroom: how many more
 * work items they may run before they reach their fair share, whether or not anyone is waiting
 */
async function fairShareLimits(
  tx: Transaction, bindings: Record<string, string | number | Date>, podCount: number,
): Promise<{ limits: Record<string, number>; headroom: Record<string, number> }> {
  const rows = rawRows(await tx.raw(`
    WITH ${classifiedCtes()}
    SELECT
      ${usernameColumn('Classified')} AS username,
      SUM(running_count) AS running,
      SUM(ready_count) AS ready
    FROM Classified
    GROUP BY 1
  `, bindings));
  const loads = rows.map((r) => ({
    user: r.username as string,
    running: Number(r.running) || 0,
    ready: Number(r.ready) || 0,
  }));
  const shares = maxMinFairShares(Object.fromEntries(loads.map((l) => [l.user, l.running + l.ready])), podCount);
  const limits: Record<string, number> = Object.create(null);
  const headroom: Record<string, number> = Object.create(null);
  for (const load of loads) {
    // hold back only for someone it would help - another user below their share with work
    // ready - so holding everyone back can't leave pods idle
    const waiting = loads.some((o) => o.user !== load.user && o.ready > 0 && o.running < (shares[o.user] ?? 0) - 1e-9);
    // a fractional share rounds up, so a user isn't held below it
    headroom[load.user] = Math.max(0, Math.ceil((shares[load.user] ?? 0) - 1e-9) - load.running);
    limits[load.user] = waiting ? headroom[load.user] : Infinity;
  }
  return { limits, headroom };
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
function unmeasuredAllowance(s: FairShareFastLaneSettings, slowWorkCapacity: number): number {
  return Math.max(s.unmeasuredLimit, Math.floor(s.unmeasuredFraction * slowWorkCapacity));
}

interface NextJob {
  jobId: string;
  username: string;
  isSlow: boolean;
  isAsync: boolean;
  // running work items if the (job, service) hasn't been measured yet, otherwise null
  unmeasuredRunning: number | null;
}

interface NextJobs {
  jobs: NextJob[];
  slowRunningCount: number;
  unmeasuredRunningCount: number;
  // running unmeasured work that's slow because one of its work items has been running too long
  unmeasuredSlowRunningCount: number;
  // as getNextJobIdsDurationBased returns: 0 unless slow work may be handed out in this batch
  availableSlowWorkSlots: number;
}

/**
 * The jobs to work in priority order: getNextJobIdsDurationBased's selection (round robin by
 * user, users ranked by the expected runtime of their in-progress work for the service, a
 * user's sync jobs before their async ones, slow work excluded once the reserve is reached),
 * plus the new job limits and the service level estimate for unmeasured work.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param batchSize - The batch size
 * @param context - the scheduling context
 * @param slowWorkCapacity - the most slow work items that may run on the service
 * @param s - the policy settings
 * @returns the jobs and the service's slow and unmeasured work
 */
async function getNextJobs(
  tx: Transaction, serviceID: string, batchSize: number, context: SchedulingContext, slowWorkCapacity: number,
  s: FairShareFastLaneSettings,
): Promise<NextJobs> {
  const bindings = classificationBindings(serviceID, context.slowWorkThresholdMs);
  let counts = await getSlowWorkCounts(tx, bindings);
  const { slowReadyCount } = counts;
  const mayScheduleSlowWork = slowReadyCount > 0 && counts.slowRunningCount < slowWorkCapacity;
  if (mayScheduleSlowWork && db.client.config.client === 'pg') {
    // serializes admitting slow work across concurrent scheduler pods, and re-reads the counts
    // once the lock is held, as getNextJobIdsDurationBased does
    await tx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [serviceID]);
    counts = await getSlowWorkCounts(tx, bindings);
  }
  const { slowRunningCount, unmeasuredRunningCount, unmeasuredSlowRunningCount } = counts;
  const hasSlowWorkCapacity = slowRunningCount < slowWorkCapacity;
  const availableSlowWorkSlots = mayScheduleSlowWork ? Math.max(0, slowWorkCapacity - slowRunningCount) : 0;
  // sqlite (test-only) doesn't support SKIP LOCKED; it's only needed for real concurrent
  // scheduler pods, which only run against postgres.
  const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

  // Eligible: measured slow work while there's slow work capacity, within the new job limits if
  // it's unmeasured work that's been running too long; measured fast work; and unmeasured work
  // within the new job limits (with no limit, as getNextJobIdsDurationBased does: everything
  // while there's slow work capacity, otherwise only unmeasured work with nothing running)
  const sql = `
    WITH ${classifiedCtes()},
    Eligible AS (
      SELECT
        uw.job_id,
        uw.last_worked,
        ${usernameColumn('uw')} AS username,
        uw.is_async,
        uw.slow AS is_slow,
        CASE WHEN uw.duration IS NULL THEN uw.running_count ELSE NULL END AS unmeasured_running
      FROM Classified uw
      WHERE uw.ready_count > 0
        AND (
          (uw.slow = 1 AND :hasCapacity = 1
            AND (uw.duration IS NOT NULL OR :unmeasuredLimit <= 0
              OR uw.running_count < :unmeasuredLimit
              OR :sharedAllowanceLeft = 1))
          OR (uw.slow = 0 AND uw.duration IS NOT NULL)
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit <= 0
            AND (:hasCapacity = 1 OR (uw.running_count = 0 AND uw.completed_count = 0)))
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit > 0
            AND uw.running_count < :unmeasuredLimit)
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit > 0
            AND :sharedAllowanceLeft = 1 AND :unmeasuredCapacityLeft = 1)
        )
    ),
    ServiceEstimate AS (
      SELECT AVG(duration) AS estimate
      FROM Classified
      WHERE duration IS NOT NULL
    ),
    UserRank AS (
      SELECT
        ${usernameColumn('u')} AS username,
        SUM(CAST(u.running_count AS BIGINT) * COALESCE(u.duration, e.estimate, :unmeasuredDefault)) AS expected_runtime,
        MAX(u.last_worked) AS most_recent_worked
      FROM Classified u
      CROSS JOIN ServiceEstimate e
      GROUP BY 1
    ),
    RankedJobs AS (
      SELECT
        e.job_id,
        e.last_worked,
        e.username,
        e.is_slow,
        e.is_async,
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
        R.is_async,
        R.unmeasured_running,
        ROW_NUMBER() OVER (
          ORDER BY R.user_row_num ASC, ur.expected_runtime ASC, ur.most_recent_worked ASC, R.last_worked ASC
        ) AS overall_row_num
      FROM RankedJobs R
      JOIN UserRank ur ON ur.username = R.username
      ORDER BY overall_row_num
      LIMIT :batchSize
    )
    SELECT uw.job_id, i.username, i.is_slow, i.is_async, i.unmeasured_running
    FROM user_work uw
    JOIN Interleaved i
      ON i.job_id = uw.job_id
    WHERE uw.service_id = :serviceID
    ORDER BY i.overall_row_num
    ${lockClause}
  `;

  const rows = rawRows(await tx.raw(sql, {
    ...bindings,
    hasCapacity: hasSlowWorkCapacity ? 1 : 0,
    // compared here rather than in the SQL, where postgres can't add two untyped parameters:
    // whether the shared allowance for unmeasured work has room, and whether the slow work
    // capacity has room for more unmeasured work
    sharedAllowanceLeft: unmeasuredRunningCount + unmeasuredSlowRunningCount < unmeasuredAllowance(s, slowWorkCapacity) ? 1 : 0,
    unmeasuredCapacityLeft: slowRunningCount + unmeasuredRunningCount < slowWorkCapacity ? 1 : 0,
    unmeasuredLimit: s.unmeasuredLimit,
    // the expected duration of unmeasured work when the service has no measured durations yet
    unmeasuredDefault: DEFAULT_EXPECTED_DURATION_MS,
    batchSize,
  }));

  if (slowReadyCount > 0 && !hasSlowWorkCapacity) {
    context.logger.info(`Fast lane only for service ${serviceID}: ${slowRunningCount}/${slowWorkCapacity} ` +
      `slow-work capacity in use (${context.servicePodCount} pods), excluding slow jobs from this scheduling round.`);
  }

  return {
    jobs: rows.map((r) => ({
      jobId: r.job_id,
      username: r.username,
      isSlow: Number(r.is_slow) === 1,
      // a boolean on postgres, 0/1 on sqlite
      isAsync: r.is_async === true || Number(r.is_async) === 1,
      unmeasuredRunning: r.unmeasured_running === null || r.unmeasured_running === undefined
        ? null : Number(r.unmeasured_running),
    })),
    slowRunningCount,
    unmeasuredRunningCount,
    unmeasuredSlowRunningCount,
    availableSlowWorkSlots,
  };
}

/**
 * Fair share fast lane fair queueing. See the comment at the top of this file.
 */
export const fairShareFastLanePolicy: FairQueueingPolicy = {
  name: 'fair-share-fast-lane',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const s = fairShareFastLaneSettings();
    const podCount = context.servicePodCount;
    const slowWorkCapacity = getSlowWorkCapacity(podCount, s.reserveFraction ?? context.fastLaneReserveFraction);
    const { jobs, slowRunningCount, unmeasuredRunningCount, unmeasuredSlowRunningCount, availableSlowWorkSlots } =
      await getNextJobs(tx, serviceID, batchSize, context, slowWorkCapacity, s);
    let remainingSlowWorkSlots = availableSlowWorkSlots;
    // unmeasured work beyond the unmeasured limit might turn out to be slow, so it shares the
    // slow work capacity with the work known to be slow
    let remainingUnmeasuredSlots = Math.max(0, slowWorkCapacity - slowRunningCount - unmeasuredRunningCount);
    // what's left of the allowance for all unmeasured work together
    let remainingSharedAllowance = unmeasuredAllowance(s, slowWorkCapacity) - unmeasuredRunningCount - unmeasuredSlowRunningCount;
    const { limits, headroom } = podCount > 0
      ? await fairShareLimits(tx, classificationBindings(serviceID, context.slowWorkThresholdMs), podCount)
      : { limits: Object.create(null), headroom: Object.create(null) };

    // takes up to workSize work items from a job, within the slow work and new job limits, and
    // (except for sync requests) fair share: by default the limit (only while someone else
    // below their share is waiting), 'headroom' its user's room below their share whether or not
    // anyone is waiting, or 'none'
    const take = async (job: NextJob, workSize: number, share: 'limit' | 'headroom' | 'none' = 'limit'): Promise<number> => {
      let size = workSize;
      if (job.isSlow) size = Math.min(size, remainingSlowWorkSlots);
      if (job.isAsync && share !== 'none') {
        size = Math.min(size, (share === 'limit' ? limits : headroom)[job.username] ?? Infinity);
      }
      if (s.unmeasuredLimit > 0 && job.unmeasuredRunning !== null) {
        const limit = s.unmeasuredLimit - job.unmeasuredRunning;
        // beyond the limit, what's left of the shared allowance while the slow work capacity has room
        size = Math.min(size, Math.max(limit, Math.min(remainingSharedAllowance, remainingUnmeasuredSlots)));
      }
      if (size <= 0) return 0;
      const numTaken = await takeWorkItems(job.jobId, size);
      if (job.unmeasuredRunning !== null) {
        // so a later pass over the same job (the work-conserving one below) doesn't give it
        // its unmeasured limit again
        job.unmeasuredRunning += numTaken;
        remainingUnmeasuredSlots -= numTaken;
        remainingSharedAllowance -= numTaken;
      }
      if (job.isSlow) remainingSlowWorkSlots -= numTaken;
      // a user's sync requests count towards their share too
      if (limits[job.username] !== undefined) limits[job.username] -= numTaken;
      if (headroom[job.username] !== undefined) headroom[job.username] -= numTaken;
      return numTaken;
    };

    let remainingBatchSize = batchSize;
    // sync requests first, so a batch with room for one work item goes to the sync request
    for (const job of jobs) {
      if (!job.isAsync && remainingBatchSize > 0) remainingBatchSize -= await take(job, remainingBatchSize);
    }
    // then split evenly across users, then across each user's jobs in priority order. Users are
    // shuffled for the same reason duration-based shuffles jobs: whoever comes last can use what
    // earlier users couldn't, so that shouldn't always be the same user.
    const asyncJobs = jobs.filter((j) => j.isAsync);
    const users = shuffleArray([...new Set(asyncJobs.map((j) => j.username))]);
    let remainingNumOfUsers = users.length;
    for (const user of users) {
      const userJobs = asyncJobs.filter((j) => j.username === user);
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

    // fair share is work-conserving: what's left of the batch goes first to users below their
    // share (one early in the split only got their slice), up to their share, and only what they
    // can't take (e.g. their unmeasured work is at its limit) goes to everyone else, so fair
    // share never leaves pods idle
    for (const share of ['headroom', 'none'] as const) {
      for (const job of jobs) {
        if (remainingBatchSize <= 0) break;
        remainingBatchSize -= await take(job, remainingBatchSize, share);
      }
    }
  },
};
