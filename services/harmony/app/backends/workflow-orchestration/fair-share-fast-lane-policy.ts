//
// Fair share fast lane fair queueing (FAIR_QUEUEING_POLICY=fair-share-fast-lane in the
// work-scheduler): duration based fair queueing (durationBasedPolicy - see
// getNextJobIdsDurationBased in models/user-work.ts) with fixes for the problems the fair
// queueing simulator (tools/fair-queueing-sim) found with it, chief among them holding every user
// to a fair share of the pods while others wait (fix 6). It was called adaptive-fast-lane until
// its moving average of durations (fix 2) was switched off by default. See docs/fair-queueing.md,
// and tools/fair-queueing-sim/RESULTS.md for how it compares with slot based and duration based
// fair queueing.
//
// The fast lane reserve works as duration-based's does - slow work may never use more than
// (1 - reserve) of a service's pods, even when nothing else is waiting - but it's 10%
// (FAIR_SHARE_FAST_LANE_RESERVE_FRACTION) rather than FAST_LANE_RESERVE_FRACTION's 30%: at
// production's scale fix 1 below does much of the protecting, so a smaller reserve still keeps
// sync requests within seconds when a slow user arrives first, and leaves fewer pods idle. Leaving
// pods idle when only slow work is waiting is by design (Harmony has seen slow jobs take every pod
// and leave arriving fast jobs unworked), an accepted cost, not something for this policy to fix.
// Because fix 1 below stops slow work getting past the cap before it is measured, the reserve
// mostly holds from the start, so expect more such idle time than with duration-based. Not
// entirely: every new (job, service) may run its first FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT work
// items whatever the capacity, so that it can be measured, so many new jobs at once can use some
// of the reserve until they're measured. The fixes:
//
// 1. Unmeasured work is limited. A (job, service) with no measured duration yet may only have
//    FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT work items running, so a new job whose work items turn
//    out to be slow can't fill the service before anyone knows it's slow. Beyond that limit,
//    all unmeasured work on the service together may run up to
//    FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION of the slow work capacity, while the capacity has
//    room: unmeasured work might turn out to be slow, so it shares the capacity with the work
//    known to be slow and never takes the reserve, and sharing the allowance stops a few new
//    jobs from taking every slow slot between them.
// 2. Durations track recent work. The measured duration is an exponentially weighted moving
//    average (weight FAIR_SHARE_FAST_LANE_EWMA_ALPHA on the newest work item) rather than the
//    mean over the job's lifetime, so a job whose work items get slower part way through is
//    reclassified within a few work items. Simulator only - see below.
// 3. New jobs get a realistic expected runtime. When ranking users, running work items of a
//    (job, service) that hasn't been measured yet count as the service's current mean measured
//    duration (over other jobs) rather than a flat hour, so new jobs aren't pushed to the back.
// 4. Batches are split per user. Each scheduling batch is first split evenly between users, then
//    between each user's jobs, so a user with many jobs doesn't get more of the service than a
//    user with one.
// 5. Durations exclude queue wait. The duration used is the one the service pod reports (how
//    long the work item actually ran), not Harmony's, which is at least that and also counts the
//    time between a pod taking the work item and it starting to run. Simulator only - see below.
// 6. Slow work yields to fair share while fast work waits. While another user has fast work
//    ready for the service, a user's slow work only gets new work items while that user has
//    fewer than their max-min fair share of the service's pods running. Without this, a slow
//    user refills every pod they free up to the slow work capacity, so backed up fast users
//    share only the reserve. Nothing running is interrupted - the slow user drops to their
//    share as their work items finish - and when no fast work is waiting, slow work can use up
//    to the capacity as before. FAIR_SHARE_FAST_LANE_FAIR_SHARE_ALL extends this to every user.
// 7. Long-running work is slow before it finishes. A work item that has been running longer
//    than the threshold will take longer than the threshold, so its (job, service) is treated
//    as slow from then on - without waiting for a work item to complete: it counts against the
//    slow work capacity, and fix 6 treats it as slow. It only applies to unmeasured work, and
//    only ever shows that work is slow. The current attempt's start time is used, so queue time
//    and failed attempts don't count; a stuck work item looks slow until the work-failer times
//    it out. Such work also keeps fix 1's limits until it's measured
//    (FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT), so being noticed only ever tightens what
//    it may run.
// 8. Sync requests go first. Someone is waiting on a sync request, and production limits them
//    to one granule (MAX_SYNCHRONOUS_GRANULES), so they can't crowd out async work. Fix 6
//    never holds a sync request back (FAIR_SHARE_FAST_LANE_SYNC_EXEMPT) - with FAIR_SHARE_ALL, a
//    sync request would otherwise wait behind its own user's async work once that fills the
//    user's share - though it still counts towards the share. And each batch goes to sync
//    requests before it's split between users (FAIR_SHARE_FAST_LANE_SYNC_FIRST): when a pod frees
//    up the batch may have room for only one work item, which the split could give anyone.
//
// Each fix can be switched off (see fairShareFastLaneSettings below); with all of them off and
// FAIR_SHARE_FAST_LANE_RESERVE_FRACTION=scheduler the policy makes exactly the same decisions as
// duration-based, which the simulator's `findings` command checks. The queries below follow
// getNextJobIdsDurationBased step for step so that stays true - when that function changes,
// change these with it.
//
// Fixes 2 and 5 need durations Harmony doesn't keep, so the policy can only use them where it
// keeps its own, in two columns added to user_work and updated as work items complete. Only the
// simulator does that (createFairShareFastLanePolicy with ownDurationColumns); in production it
// would take a migration and a work-updater hook, and on the production scenarios they made no
// difference, so fairShareFastLanePolicy ignores them. Without them the policy uses Harmony's own
// durations (average_duration), including their seeding from the user's history and the failed
// work item fallback.
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
 * Reads the policy's own settings from the environment. They're read on every scheduling pass
 * from process.env, which the work-scheduler's env module fills from its env-defaults (where the
 * defaults below are repeated, with descriptions). The slow work threshold, and the reserve
 * fraction when FAIR_SHARE_FAST_LANE_RESERVE_FRACTION is 'scheduler', are the work-scheduler's
 * (from the scheduling context).
 *
 * @param env - the environment to read
 * @returns the settings
 * @throws Error - if FAIR_SHARE_FAST_LANE_RESERVE_FRACTION isn't a fraction from 0 to 1 or
 * 'scheduler'
 */
export function fairShareFastLaneSettings(env: NodeJS.ProcessEnv = process.env): FairShareFastLaneSettings {
  const boolean = (name: string, defaultValue: boolean): boolean => {
    const value = env[name];
    return value === undefined ? defaultValue : value.toLowerCase() === 'true';
  };
  const reserve = env.FAIR_SHARE_FAST_LANE_RESERVE_FRACTION ?? '0.1';
  const reserveFraction = reserve === 'scheduler' ? null : Number(reserve);
  if (reserveFraction !== null && (reserve.trim() === '' || !Number.isFinite(reserveFraction)
    || reserveFraction < 0 || reserveFraction > 1)) {
    throw new Error(`FAIR_SHARE_FAST_LANE_RESERVE_FRACTION must be a fraction from 0 to 1, or "scheduler", not "${reserve}"`);
  }
  return {
    reserveFraction,
    unmeasuredLimit: Number(env.FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT ?? 2),
    unmeasuredFraction: Number(env.FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION ?? 0.5),
    ewmaAlpha: Number(env.FAIR_SHARE_FAST_LANE_EWMA_ALPHA ?? 0),
    serviceEstimate: (env.FAIR_SHARE_FAST_LANE_UNMEASURED_ESTIMATE ?? 'service') === 'service',
    unmeasuredDefaultMs: Number(env.FAIR_SHARE_FAST_LANE_UNMEASURED_DEFAULT_MS ?? DEFAULT_EXPECTED_DURATION_MS),
    splitByUser: boolean('FAIR_SHARE_FAST_LANE_SPLIT_BY_USER', true),
    useServiceDuration: boolean('FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION', false),
    slowFairShare: boolean('FAIR_SHARE_FAST_LANE_SLOW_FAIR_SHARE', true),
    runningEvidence: boolean('FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE', true),
    runningEvidenceKeepsLimit: boolean('FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT', true),
    fairShareAll: boolean('FAIR_SHARE_FAST_LANE_FAIR_SHARE_ALL', true),
    syncExempt: boolean('FAIR_SHARE_FAST_LANE_SYNC_EXEMPT', true),
    syncFirst: boolean('FAIR_SHARE_FAST_LANE_SYNC_FIRST', true),
  };
}

/**
 * Whether the settings need the policy's own durations (fixes 2 and 5) rather than Harmony's.
 *
 * @param s - the policy settings
 * @returns true if they need its own durations
 */
export function usesOwnDurations(s: FairShareFastLaneSettings): boolean {
  return s.ewmaAlpha > 0 || s.useServiceDuration;
}

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
export function classifiedCtes(s: FairShareFastLaneSettings): string {
  // Harmony's duration (EFFECTIVE_DURATION_SQL: the mean of the successful work items, or of the
  // failed ones if there are no successes yet, or a duration seeded from the user's history, or
  // NULL); its columns are user_work's, the only table in the FROM clause it's used in
  const duration = usesOwnDurations(s) ? `COALESCE(uw.adaptive_duration, ${EFFECTIVE_DURATION_SQL})` : EFFECTIVE_DURATION_SQL;
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
export function classificationBindings(
  serviceID: string, slowWorkThresholdMs: number, s: FairShareFastLaneSettings,
): Record<string, string | number | Date> {
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
  tx: Transaction, bindings: Record<string, string | number | Date>, s: FairShareFastLaneSettings,
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
 * For fix 6: how many more work items each user's slow work may take in this scheduling pass.
 * While another user has fast work ready, a user is held to their max-min fair share of the
 * service's pods (counting all of their running work on the service); otherwise there is no
 * limit beyond the slow work capacity.
 *
 * @param tx - The database transaction
 * @param bindings - the classification bindings
 * @param podCount - the number of pods running the service
 * @param s - the policy settings
 * @returns for users with work for the service, the limit, and their headroom: how many more
 * work items they may run before they reach their fair share, whether or not anyone is waiting
 */
async function slowWorkLimits(
  tx: Transaction, bindings: Record<string, string | number | Date>, podCount: number, s: FairShareFastLaneSettings,
): Promise<{ limits: Record<string, number>; headroom: Record<string, number> }> {
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
  const headroom: Record<string, number> = Object.create(null);
  for (const load of loads) {
    // all users: hold back only for someone it would help - another user below their share
    // with work ready - so holding everyone back can't leave pods idle. Slow users only: while
    // another user has fast work ready
    const waiting = s.fairShareAll
      ? loads.some((o) => o.user !== load.user && o.ready > 0 && o.running < (shares[o.user] ?? 0) - 1e-9)
      : loads.some((o) => o.user !== load.user && o.fastReady > 0);
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
  // running unmeasured work that fix 7 shows is slow, if it keeps fix 1's limits, else 0
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
  s: FairShareFastLaneSettings,
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
  // fix 7's slow unmeasured work only counts against fix 1's allowance when it keeps fix 1's limits
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
    // compared here rather than in the SQL, where postgres can't add two untyped parameters:
    // whether the shared allowance for unmeasured work has room, and whether the slow work
    // capacity has room for more unmeasured work
    sharedAllowanceLeft: unmeasuredRunningCount + unmeasuredSlowRunningCount < unmeasuredAllowance(s, slowWorkCapacity) ? 1 : 0,
    unmeasuredCapacityLeft: slowRunningCount + unmeasuredRunningCount < slowWorkCapacity ? 1 : 0,
    keepsLimit: s.runningEvidenceKeepsLimit ? 1 : 0,
    unmeasuredLimit: s.unmeasuredLimit,
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

/**
 * Creates the fair share fast lane policy.
 *
 * @param options - ownDurationColumns: user_work has the policy's own duration columns
 * (adaptive_duration and adaptive_count, kept up to date as work items complete), so fixes 2
 * and 5 can be used. Only the simulator has them; without them those settings are ignored.
 * @returns the policy
 */
export function createFairShareFastLanePolicy(options: { ownDurationColumns?: boolean } = {}): FairQueueingPolicy {
  let warnedOwnDurations = false;
  return {
    name: 'fair-share-fast-lane',

    async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
      let s = fairShareFastLaneSettings();
      if (usesOwnDurations(s) && !options.ownDurationColumns) {
        if (!warnedOwnDurations) {
          context.logger.warn('FAIR_SHARE_FAST_LANE_EWMA_ALPHA and FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION are '
            + "ignored: they need work item durations Harmony doesn't keep");
          warnedOwnDurations = true;
        }
        s = { ...s, ewmaAlpha: 0, useServiceDuration: false };
      }
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
      const { limits: slowLimits, headroom } = s.slowFairShare && podCount > 0 && (s.fairShareAll || jobs.some((j) => j.isSlow))
        ? await slowWorkLimits(tx, classificationBindings(serviceID, context.slowWorkThresholdMs, s), podCount, s)
        : { limits: Object.create(null), headroom: Object.create(null) };

      // takes up to workSize work items from a job, within the slow work and unmeasured limits,
      // and fair share: by default the limit (only while someone else below their share is
      // waiting), 'headroom' its user's room below their share whether or not anyone is waiting,
      // or 'none'
      const take = async (job: NextJob, workSize: number, share: 'limit' | 'headroom' | 'none' = 'limit'): Promise<number> => {
        let size = workSize;
        if (job.isSlow) size = Math.min(size, remainingSlowWorkSlots);
        const shareApplies = (job.isSlow || s.fairShareAll) && !(s.syncExempt && !job.isAsync);
        if (shareApplies && share !== 'none') {
          size = Math.min(size, (share === 'limit' ? slowLimits : headroom)[job.username] ?? Infinity);
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
        // the user's fast work counts towards their share too
        if (slowLimits[job.username] !== undefined) slowLimits[job.username] -= numTaken;
        if (headroom[job.username] !== undefined) headroom[job.username] -= numTaken;
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

      // fix 6 for all users is work-conserving: what's left of the batch goes first to users below
      // their share (one early in the split only got their slice), up to their share, and only
      // what they can't take (e.g. their unmeasured work is at its limit) goes to everyone else,
      // so fair share never leaves pods idle
      if (s.slowFairShare && s.fairShareAll && remainingBatchSize > 0) {
        for (const share of ['headroom', 'none'] as const) {
          for (const job of jobs) {
            if (remainingBatchSize <= 0) break;
            remainingBatchSize -= await take(job, remainingBatchSize, share);
          }
        }
      }
    },
  };
}

/**
 * Fair share fast lane fair queueing, as the work-scheduler runs it: Harmony's own durations, so
 * fixes 2 and 5 are off whatever the settings say.
 */
export const fairShareFastLanePolicy: FairQueueingPolicy = createFairShareFastLanePolicy();
