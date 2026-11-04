//
// Harmony's duration based fair queueing (durationBasedPolicy - see getNextJobIdsDurationBased in
// services/harmony/app/models/user-work.ts) with fixes for the problems the simulator found with
// it. The fast lane reserve itself is unchanged - slow work may never use more than
// (1 - FAST_LANE_RESERVE_FRACTION) of a service's pods, even when nothing else is waiting. That
// is by design (Harmony has seen slow jobs take every pod and leave arriving fast jobs unworked),
// so pods the reserve leaves idle are an accepted cost, not something for this policy to fix.
// Because fix 1 below stops slow work getting past the cap before it is measured, the reserve
// holds from the start, so expect more such idle time than with duration-based. The fixes:
//
// 1. Unmeasured work is limited. A (job, service) with no measured duration yet may only have
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
//    long the work item actually ran), not Harmony's, which is at least that and also counts the
//    time between a pod taking the work item and it starting to run.
// 6. Slow work yields to fair share while fast work waits. While another user has fast work
//    ready for the service, a user's slow work only gets new work items while that user has
//    fewer than their max-min fair share of the service's pods running. Without this, a slow
//    user refills every pod they free up to the slow work capacity, so backed up fast users
//    share only the reserve. Nothing running is interrupted - the slow user drops to their
//    share as their work items finish - and when no fast work is waiting, slow work can use up
//    to the capacity as before. ADAPTIVE_FAST_LANE_FAIR_SHARE_ALL extends this to every user.
// 7. Long-running work is slow before it finishes. A work item that has been running longer
//    than the threshold will take longer than the threshold, so its (job, service) is treated
//    as slow from then on - without waiting for a work item to complete: it counts against the
//    slow work capacity, and fix 6 treats it as slow. It only applies to unmeasured work, and
//    only ever shows that work is slow. The current attempt's start time is used, so queue time
//    and failed attempts don't count; a stuck work item looks slow until the work-failer times
//    it out. Such work also keeps fix 1's limits until it's measured
//    (ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT), so being noticed only ever tightens what
//    it may run. Otherwise it would move from fix 1's limits to the larger slow work capacity:
//    in story 11 that makes the fast job a third slower, though the three users then share the
//    service slightly more evenly.
// 8. Sync requests go first. Someone is waiting on a sync request, and production limits them
//    to one granule (MAX_SYNCHRONOUS_GRANULES), so they can't crowd out async work. Fix 6
//    never holds a sync request back (ADAPTIVE_FAST_LANE_SYNC_EXEMPT) - with FAIR_SHARE_ALL, a
//    sync request would otherwise wait behind its own user's async work once that fills the
//    user's share - though it still counts towards the share. And each batch goes to sync
//    requests before it's split between users (ADAPTIVE_FAST_LANE_SYNC_FIRST): when a pod frees
//    up the batch may have room for only one work item, which the split could give anyone.
//
// Each fix can be switched off (see settings() below); with all of them off the policy makes
// exactly the same decisions as duration-based, which `findings` checks (the catalog's
// equivalentTo). The queries below follow getNextJobIdsDurationBased step for step so that stays
// true - when that function changes, change these with it.
//
// Fixes 2 and 5 need durations Harmony doesn't keep, so the policy keeps its own in two columns
// it adds to user_work (setupAdaptiveFastLane), updated by its completion hook
// (adaptiveWorkItemCompleted). Harmony's own average_duration is left alone: with neither fix
// on, the policy uses Harmony's durations, including their seeding from the user's history and
// the failed work item fallback.
//

import type { CompletedWorkItem } from './index';
import type { SchedulingContext, FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import UserWork, { DEFAULT_EXPECTED_DURATION_MS, getSlowWorkCapacity } from '../../../../services/harmony/app/models/user-work';
import { WorkItemStatus } from '../../../../services/harmony/app/models/work-item-interface';
import db, { Transaction } from '../../../../services/harmony/app/util/db';
import schedulerEnv from '../../../../services/work-scheduler/app/util/env';

interface Settings {
  // max running work items for an unmeasured (job, service); 0 = no limit (duration-based)
  unmeasuredLimit: number;
  // all unmeasured work on the service together may run up to this fraction of the slow work
  // capacity, sharing the capacity with slow work (each (job, service) can always run
  // unmeasuredLimit); 0 = just unmeasuredLimit
  unmeasuredFraction: number;
  // weight of the newest work item in the moving average; 0 = lifetime mean (duration-based)
  ewmaAlpha: number;
  // true = unmeasured work counts as the service's mean measured duration when ranking users
  serviceEstimate: boolean;
  // expected duration of unmeasured work when there's nothing better (duration-based: 1 hour)
  unmeasuredDefaultMs: number;
  splitByUser: boolean;
  useServiceDuration: boolean;
  // true = slow work is held to its user's fair share while other users' fast work waits
  slowFairShare: boolean;
  // true = an unmeasured (job, service) is also slow while one of its work items has been running
  // longer than the threshold
  runningEvidence: boolean;
  // true = unmeasured work that fix 7 shows is slow also keeps fix 1's limits until it's measured
  runningEvidenceKeepsLimit: boolean;
  // true = fix 6 holds every user to their fair share while another user below theirs has work
  // ready, not just users with slow work
  fairShareAll: boolean;
  // true = fix 6 never holds back a sync request (it still counts towards its user's share)
  syncExempt: boolean;
  // true = each batch goes to sync requests first, before it's split between users
  syncFirst: boolean;
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
 * Reads the policy's own settings from the environment. The slow work threshold and the fast
 * lane reserve fraction are the work-scheduler's (from the scheduling context).
 *
 * @returns the settings
 */
function settings(): Settings {
  const { env } = process;
  return {
    unmeasuredLimit: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT ?? 2),
    unmeasuredFraction: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION ?? 0.5),
    ewmaAlpha: Number(env.ADAPTIVE_FAST_LANE_EWMA_ALPHA ?? 0.2),
    serviceEstimate: (env.ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE ?? 'service') === 'service',
    unmeasuredDefaultMs: Number(env.ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS ?? DEFAULT_EXPECTED_DURATION_MS),
    splitByUser: envBoolean('ADAPTIVE_FAST_LANE_SPLIT_BY_USER', true),
    useServiceDuration: envBoolean('ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION', true),
    slowFairShare: envBoolean('ADAPTIVE_FAST_LANE_SLOW_FAIR_SHARE', true),
    runningEvidence: envBoolean('ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE', true),
    runningEvidenceKeepsLimit: envBoolean('ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT', true),
    fairShareAll: envBoolean('ADAPTIVE_FAST_LANE_FAIR_SHARE_ALL', true),
    syncExempt: envBoolean('ADAPTIVE_FAST_LANE_SYNC_EXEMPT', true),
    syncFirst: envBoolean('ADAPTIVE_FAST_LANE_SYNC_FIRST', true),
  };
}

/**
 * Whether the policy measures durations itself (fixes 2 and 5) rather than using Harmony's.
 *
 * @param s - the policy settings
 * @returns true if it keeps its own durations
 */
function ownDurations(s: Settings): boolean {
  return s.ewmaAlpha > 0 || s.useServiceDuration;
}

// The duration Harmony classifies a (job, service) by, as EFFECTIVE_DURATION_SQL in user-work.ts:
// the mean of its successful work items, or of its failed ones if it has no successes yet, or a
// duration seeded from the user's history, or NULL
const HARMONY_DURATION_SQL = '(CASE WHEN uw.completed_count = 0 AND uw.failed_count > 0 '
  + 'THEN uw.failed_sum_duration_ms / uw.failed_count ELSE uw.average_duration END)';

/**
 * The CTEs that classify each (job, service) of the service as slow or not, shared by every
 * query that needs to know what's slow so they all agree. A (job, service)'s duration is
 * Harmony's, or (fixes 2 and 5) the policy's own once it has measured one; it's slow if that's
 * over the threshold or (fix 7) it has no duration yet and one of its work items has been
 * running for longer than the threshold in its current attempt. A running item's startedAt is
 * when a pod took it off the queue, and is reset by a retry, so time spent queued or in failed
 * attempts doesn't count. Uses the bindings from classificationBindings.
 *
 * @param s - the policy settings
 * @returns the CTEs, for a WITH clause
 */
function classifiedCtes(s: Settings): string {
  const duration = ownDurations(s) ? `COALESCE(uw.adaptive_duration, ${HARMONY_DURATION_SQL})` : HARMONY_DURATION_SQL;
  return `
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
 * @param s - the policy settings
 * @returns the bindings
 */
function classificationBindings(serviceID: string, slowWorkThresholdMs: number, s: Settings): Record<string, string | number | Date> {
  return {
    serviceID,
    threshold: slowWorkThresholdMs,
    runningEvidence: s.runningEvidence ? 1 : 0,
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
function rawRows(results: any): any[] {
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
  // running work items of unmeasured (job, service)s that are slow (fix 7)
  unmeasuredSlowRunningCount: number;
}

/**
 * Counts the service's slow and unmeasured work, as getSlowWorkCounts in user-work.ts does.
 *
 * @param tx - The database transaction
 * @param bindings - the classification bindings
 * @param s - the policy settings
 * @returns the counts
 */
async function getSlowWorkCounts(
  tx: Transaction, bindings: Record<string, string | number | Date>, s: Settings,
): Promise<SlowWorkCounts> {
  const [row] = rawRows(await tx.raw(`
    WITH ${classifiedCtes(s)}
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
 * Computes the max-min fair allocation of a capacity among users with the given demands: every
 * user gets an equal share, except that users who want less than that get what they want and
 * the remainder is shared among the rest.
 *
 * @param demands - each user's demand
 * @param capacity - the total capacity
 * @returns each user's fair share
 */
function maxMinFairShares(demands: Record<string, number>, capacity: number): Record<string, number> {
  const shares: Record<string, number> = Object.create(null);
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
 * @param bindings - the classification bindings
 * @param podCount - the number of pods running the service
 * @param s - the policy settings
 * @returns the limit per user, for users with work for the service
 */
async function slowWorkLimits(
  tx: Transaction, bindings: Record<string, string | number | Date>, podCount: number, s: Settings,
): Promise<Record<string, number>> {
  // unmeasured work counts as fast unless it's been running too long, as when classifying jobs
  const rows = rawRows(await tx.raw(`
    WITH ${classifiedCtes(s)}
    SELECT
      ${usernameColumn('Classified')} AS username,
      SUM(running_count) AS running,
      SUM(ready_count) AS ready,
      SUM(CASE WHEN slow = 0 THEN ready_count ELSE 0 END) AS fast_ready
    FROM Classified
    GROUP BY 1
  `, bindings));
  const loads = rows.map((r) => ({
    user: r.username as string,
    running: Number(r.running) || 0,
    ready: Number(r.ready) || 0,
    fastReady: Number(r.fast_ready) || 0,
  }));
  const shares = maxMinFairShares(Object.fromEntries(loads.map((l) => [l.user, l.running + l.ready])), podCount);
  const limits: Record<string, number> = Object.create(null);
  for (const load of loads) {
    // all users: hold back only for someone it would help - another user below their share
    // with work ready - so holding everyone back can't leave pods idle. Slow users only: while
    // another user has fast work ready
    const waiting = s.fairShareAll
      ? loads.some((o) => o.user !== load.user && o.ready > 0 && o.running < (shares[o.user] ?? 0) - 1e-9)
      : loads.some((o) => o.user !== load.user && o.fastReady > 0);
    // a fractional share rounds up, so a user isn't held below it
    limits[load.user] = waiting ? Math.max(0, Math.ceil((shares[load.user] ?? 0) - 1e-9) - load.running) : Infinity;
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
  isAsync: boolean;
  // running work items if the (job, service) hasn't been measured yet, otherwise null
  unmeasuredRunning: number | null;
}

interface NextJobs {
  jobs: NextJob[];
  slowRunningCount: number;
  unmeasuredRunningCount: number;
  // running unmeasured work that fix 7 shows is slow, if it keeps fix 1's limits (fix 10), else 0
  unmeasuredSlowRunningCount: number;
  // as getNextJobIdsDurationBased returns: 0 unless slow work may be handed out in this batch
  availableSlowWorkSlots: number;
}

/**
 * The jobs to work in priority order: getNextJobIdsDurationBased's selection (round robin by
 * user, users ranked by the expected runtime of their in-progress work for the service, a
 * user's sync jobs before their async ones, slow work excluded once the reserve is reached),
 * plus the unmeasured work limit and the service level estimate for unmeasured work.
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
  s: Settings,
): Promise<NextJobs> {
  const bindings = classificationBindings(serviceID, context.slowWorkThresholdMs, s);
  let counts = await getSlowWorkCounts(tx, bindings, s);
  const { slowReadyCount } = counts;
  const mayScheduleSlowWork = slowReadyCount > 0 && counts.slowRunningCount < slowWorkCapacity;
  if (mayScheduleSlowWork && db.client.config.client === 'pg') {
    // serializes admitting slow work across concurrent scheduler pods, and re-reads the counts
    // once the lock is held, as getNextJobIdsDurationBased does
    await tx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [serviceID]);
    counts = await getSlowWorkCounts(tx, bindings, s);
  }
  const { slowRunningCount, unmeasuredRunningCount } = counts;
  // fix 10: only counted against fix 1's allowance when such work keeps fix 1's limits
  const unmeasuredSlowRunningCount = s.runningEvidenceKeepsLimit ? counts.unmeasuredSlowRunningCount : 0;
  const hasSlowWorkCapacity = slowRunningCount < slowWorkCapacity;
  const availableSlowWorkSlots = mayScheduleSlowWork ? Math.max(0, slowWorkCapacity - slowRunningCount) : 0;
  // sqlite (test-only) doesn't support SKIP LOCKED; it's only needed for real concurrent
  // scheduler pods, which only run against postgres.
  const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

  // With every fix off, Eligible admits what getNextJobIdsDurationBased's does: everything while
  // there's slow work capacity, otherwise fast work and unmeasured work with nothing running
  const sql = `
    WITH ${classifiedCtes(s)},
    Eligible AS (
      SELECT
        uw.job_id,
        uw.last_worked,
        ${usernameColumn('uw')} AS username,
        uw.is_async,
        uw.slow AS is_slow,
        CASE WHEN uw.duration IS NULL AND (uw.slow = 0 OR :keepsLimit = 1) THEN uw.running_count ELSE NULL END AS unmeasured_running
      FROM Classified uw
      WHERE uw.ready_count > 0
        AND (
          (uw.slow = 1 AND :hasCapacity = 1
            AND (:keepsLimit = 0 OR uw.duration IS NOT NULL OR :unmeasuredLimit <= 0
              OR uw.running_count < :unmeasuredLimit
              OR :unmeasuredRunning + :unmeasuredSlowRunning < :unmeasuredAllowance))
          OR (uw.slow = 0 AND uw.duration IS NOT NULL)
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit <= 0
            AND (:hasCapacity = 1 OR (uw.running_count = 0 AND uw.completed_count = 0)))
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit > 0
            AND uw.running_count < :unmeasuredLimit)
          OR (uw.slow = 0 AND uw.duration IS NULL AND :unmeasuredLimit > 0
            AND :unmeasuredRunning + :unmeasuredSlowRunning < :unmeasuredAllowance
            AND :slowRunning + :unmeasuredRunning < :capacity)
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
        SUM(CAST(u.running_count AS BIGINT) * COALESCE(
          u.duration,
          CASE WHEN :serviceEstimate = 1 THEN e.estimate ELSE NULL END,
          :unmeasuredDefault)) AS expected_runtime,
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
    capacity: slowWorkCapacity,
    slowRunning: slowRunningCount,
    unmeasuredRunning: unmeasuredRunningCount,
    unmeasuredSlowRunning: unmeasuredSlowRunningCount,
    keepsLimit: s.runningEvidenceKeepsLimit ? 1 : 0,
    unmeasuredLimit: s.unmeasuredLimit,
    unmeasuredAllowance: unmeasuredAllowance(s, slowWorkCapacity),
    serviceEstimate: s.serviceEstimate ? 1 : 0,
    unmeasuredDefault: s.unmeasuredDefaultMs,
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

export const adaptiveFastLanePolicy: FairQueueingPolicy = {
  name: 'adaptive-fast-lane',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const s = settings();
    const podCount = context.servicePodCount;
    const slowWorkCapacity = getSlowWorkCapacity(podCount, context.fastLaneReserveFraction);
    const { jobs, slowRunningCount, unmeasuredRunningCount, unmeasuredSlowRunningCount, availableSlowWorkSlots } =
      await getNextJobs(tx, serviceID, batchSize, context, slowWorkCapacity, s);
    let remainingSlowWorkSlots = availableSlowWorkSlots;
    // unmeasured work beyond the unmeasured limit might turn out to be slow, so it shares the
    // slow work capacity with the work known to be slow
    let remainingUnmeasuredSlots = Math.max(0, slowWorkCapacity - slowRunningCount - unmeasuredRunningCount);
    // what's left of the allowance for all unmeasured work together
    let remainingSharedAllowance = unmeasuredAllowance(s, slowWorkCapacity) - unmeasuredRunningCount - unmeasuredSlowRunningCount;
    const slowLimits = s.slowFairShare && podCount > 0 && (s.fairShareAll || jobs.some((j) => j.isSlow))
      ? await slowWorkLimits(tx, classificationBindings(serviceID, context.slowWorkThresholdMs, s), podCount, s)
      : Object.create(null);

    // takes up to workSize work items from a job, within the slow work, fair share (unless
    // ignoreShare) and unmeasured limits
    const take = async (job: NextJob, workSize: number, ignoreShare = false): Promise<number> => {
      let size = workSize;
      if (job.isSlow) size = Math.min(size, remainingSlowWorkSlots);
      const shareApplies = (job.isSlow || s.fairShareAll) && !(s.syncExempt && !job.isAsync);
      if (!ignoreShare && shareApplies) size = Math.min(size, slowLimits[job.username] ?? Infinity);
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
    // fix 8: sync requests first, so a batch with room for one work item goes to the sync request
    let splitJobs = jobs;
    if (s.syncFirst) {
      for (const job of jobs) {
        if (!job.isAsync && remainingBatchSize > 0) remainingBatchSize -= await take(job, remainingBatchSize);
      }
      splitJobs = jobs.filter((j) => j.isAsync);
    }
    if (!s.splitByUser) {
      // split evenly across jobs, as duration-based does
      let remainingNumOfJobs = splitJobs.length;
      for (const job of shuffleArray(splitJobs)) {
        const workSize = remainingNumOfJobs > 0 ? Math.ceil(remainingBatchSize / remainingNumOfJobs) : 1;
        remainingBatchSize -= await take(job, workSize);
        remainingNumOfJobs -= 1;
      }
    } else {
      // split evenly across users, then across each user's jobs in priority order. Users are
      // shuffled for the same reason duration-based shuffles jobs: whoever comes last can use
      // what earlier users couldn't, so that shouldn't always be the same user.
      const users = shuffleArray([...new Set(splitJobs.map((j) => j.username))]);
      let remainingNumOfUsers = users.length;
      for (const user of users) {
        const userJobs = splitJobs.filter((j) => j.username === user);
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
    }

    // fix 6 for all users is work-conserving: if some of the batch is left because the users
    // others were held back for couldn't take it (e.g. their unmeasured work is at its limit),
    // the users held back get it, so fair share never leaves pods idle
    if (s.slowFairShare && s.fairShareAll && remainingBatchSize > 0) {
      for (const job of jobs) {
        if (remainingBatchSize <= 0) break;
        remainingBatchSize -= await take(job, remainingBatchSize, true);
      }
    }
  },
};

/**
 * Adds the policy's own duration columns to user_work: its measured duration for each (job,
 * service), and how many work items that's from. Kept apart from Harmony's average_duration,
 * which Harmony keeps up to date itself. (A migration in production.)
 *
 * @param tx - the database transaction
 */
export async function setupAdaptiveFastLane(tx: Transaction): Promise<void> {
  await tx.raw('ALTER TABLE user_work ADD COLUMN adaptive_duration BIGINT');
  await tx.raw('ALTER TABLE user_work ADD COLUMN adaptive_count INTEGER NOT NULL DEFAULT 0');
}

/**
 * The policy's completion hook: for fixes 2 and 5, folds a successful (or warning) work item's
 * duration into the policy's own duration for its (job, service) - the duration its pod
 * reported (fix 5) or Harmony's, as a moving average (fix 2) or a lifetime mean. Failed work
 * items aren't included, as in Harmony's average_duration, which also covers a (job, service)
 * with only failures so far.
 *
 * @param tx - the work item update transaction
 * @param workItem - the completed work item
 */
export async function adaptiveWorkItemCompleted(tx: Transaction, workItem: CompletedWorkItem): Promise<void> {
  const s = settings();
  if (!ownDurations(s)) return;
  if (workItem.status !== WorkItemStatus.SUCCESSFUL && workItem.status !== WorkItemStatus.WARNING) return;
  const durationMs = Math.round(s.useServiceDuration && workItem.serviceDurationMs > 0
    ? workItem.serviceDurationMs : workItem.durationMs);
  const duration = s.ewmaAlpha > 0
    // exponentially weighted moving average, starting from the first work item's duration
    ? tx.raw(
      'CASE WHEN adaptive_count = 0 THEN ? ELSE ROUND(adaptive_duration + ? * (? - adaptive_duration)) END',
      [durationMs, s.ewmaAlpha, durationMs],
    )
    // lifetime mean (cast to BIGINT to avoid 32 bit overflow, as Harmony does)
    : tx.raw(
      'ROUND((CAST(COALESCE(adaptive_duration, 0) AS BIGINT) * adaptive_count + ?) * 1.0 / (adaptive_count + 1))',
      [durationMs],
    );
  await tx(UserWork.table)
    .where({ job_id: workItem.jobID, service_id: workItem.serviceID })
    .update({ adaptive_duration: duration, adaptive_count: tx.raw('adaptive_count + 1') });
}

/**
 * Records the fast lane state: slow work items running against the slow work capacity, whether
 * slow work is capped, how many (job, service)s are slow by their measured duration, how many
 * unmeasured work items are running, and (fix 7) how many (job, service)s are slow only because
 * of a long-running work item.
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
  const slowCapacity = getSlowWorkCapacity(servicePodCount, schedulerEnv.fastLaneReserveFraction);
  const [row] = rawRows(await tx.raw(`
    WITH ${classifiedCtes(s)}
    SELECT
      SUM(CASE WHEN slow = 1 THEN running_count ELSE 0 END) AS slow_running,
      SUM(CASE WHEN slow = 0 AND duration IS NULL THEN running_count ELSE 0 END) AS unmeasured_running,
      COUNT(CASE WHEN slow = 1 AND duration IS NOT NULL THEN 1 END) AS slow_jobs,
      COUNT(CASE WHEN slow = 1 AND duration IS NULL THEN 1 END) AS long_running_jobs
    FROM Classified
  `, classificationBindings(serviceID, schedulerEnv.slowWorkThresholdMs, s)));
  const slowRunning = Number(row?.slow_running) || 0;
  return {
    slowRunning,
    slowCapacity,
    fastLaneOnly: slowRunning >= slowCapacity ? 1 : 0,
    slowJobs: Number(row?.slow_jobs) || 0,
    unmeasuredRunning: Number(row?.unmeasured_running) || 0,
    longRunningJobs: Number(row?.long_running_jobs) || 0,
  };
}
