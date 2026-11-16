//
// Harmony's slot based fair queueing (slotBasedPolicy - see getNextJobIdsSlotBased in
// services/harmony/app/models/user-work.ts), which every production service runs, plus the
// fixes from fair-share-fast-lane that don't need work item durations:
//
// 1. Every user is held to their fair share while others wait (fair-share-fast-lane's fix 6 with
//    FAIR_SHARE_ALL). Slot based hands every job in the batch an equal slice, so a user whose work
//    items take minutes keeps accumulating pods while other users' pods come back within seconds:
//    in scenarios/production/hoss-saturated.yml a user with 8.5 minute work items ends up with
//    57% of the pods. While another user below their max-min fair share of the service's pods has
//    work ready, a user only gets new work items up to their own share (counting all of their
//    running work on the service). Nothing running is interrupted - a user above their share drops
//    to it as their work items finish - and whatever the users held back for can't take goes to
//    the users held back, so it never leaves pods idle. SLOT_BASED_FAIR_SHARE.
// 2. Sync requests go first (fair-share-fast-lane's fix 8). Fair share never holds back a sync
//    request, though it still counts towards its user's share (SLOT_BASED_SYNC_EXEMPT), and each
//    batch goes to sync requests before it's split between jobs (SLOT_BASED_SYNC_FIRST). Production
//    limits each sync request to one granule, but not sync requests in total, so many at once can
//    fill a batch before async work gets any of it.
//
// Neither needs durations, a schema change or a work-updater hook, and there's no fast lane
// reserve, so this is a much smaller change to production than fair-share-fast-lane. It picks jobs
// with Harmony's own getNextJobIds, and with every fix off it makes exactly the same decisions as
// slot-based, which `findings` checks (the catalog's equivalentTo).
//

import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import { maxMinFairShares } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-share';
import { getNextJobIds } from '../../../../services/harmony/app/models/user-work';
import type { Transaction } from '../../../../services/harmony/app/util/db';

interface Settings {
  // true = while another user below their fair share has work ready, each user is held to theirs
  fairShare: boolean;
  // true = fair share never holds back a sync request (it still counts towards its user's share)
  syncExempt: boolean;
  // true = each batch goes to sync requests first, before it's split between jobs
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
 * Reads the policy's settings from the environment.
 *
 * @returns the settings
 */
function settings(): Settings {
  return {
    fairShare: envBoolean('SLOT_BASED_FAIR_SHARE', true),
    syncExempt: envBoolean('SLOT_BASED_SYNC_EXEMPT', true),
    syncFirst: envBoolean('SLOT_BASED_SYNC_FIRST', true),
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

interface JobInfo {
  username: string;
  isAsync: boolean;
}

/**
 * Looks up the user and type of each job picked for the service.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param jobIds - the jobs
 * @returns each job's user and whether it's async, by job ID
 */
async function jobInfo(tx: Transaction, serviceID: string, jobIds: string[]): Promise<Map<string, JobInfo>> {
  if (jobIds.length === 0) return new Map();
  const rows = await tx('user_work')
    .select('job_id', 'username', 'is_async')
    .where('service_id', serviceID)
    .whereIn('job_id', jobIds);
  // is_async is a boolean on postgres, 0/1 on sqlite
  return new Map(rows.map((r) => [r.job_id, { username: r.username, isAsync: r.is_async === true || Number(r.is_async) === 1 }]));
}

/**
 * How many more work items each user may take in this scheduling pass: while another user below
 * their max-min fair share of the service's pods has work ready, up to their own share (counting
 * all of their running work on the service); otherwise no limit.
 *
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param podCount - the number of pods running the service
 * @returns the limit per user, for users with work for the service
 */
async function fairShareLimits(tx: Transaction, serviceID: string, podCount: number): Promise<Record<string, number>> {
  const rows = await tx('user_work')
    .select('username')
    .sum({ running: 'running_count', ready: 'ready_count' })
    .where('service_id', serviceID)
    .groupBy('username');
  const loads = rows.map((r) => ({ user: r.username as string, running: Number(r.running) || 0, ready: Number(r.ready) || 0 }));
  const shares = maxMinFairShares(Object.fromEntries(loads.map((l) => [l.user, l.running + l.ready])), podCount);
  const limits: Record<string, number> = Object.create(null);
  for (const load of loads) {
    // hold back only for someone it would help - another user below their share with work ready -
    // so holding users back can't leave pods idle
    const waiting = loads.some((o) => o.user !== load.user && o.ready > 0 && o.running < (shares[o.user] ?? 0) - 1e-9);
    // a fractional share rounds up, so a user isn't held below it
    limits[load.user] = waiting ? Math.max(0, Math.ceil((shares[load.user] ?? 0) - 1e-9) - load.running) : Infinity;
  }
  return limits;
}

export const slotBasedFairSharePolicy: FairQueueingPolicy = {
  name: 'slot-based-fair-share',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const s = settings();
    const { jobs } = await getNextJobIds(tx, serviceID, batchSize, context.logger);
    const info = s.fairShare || s.syncFirst
      ? await jobInfo(tx, serviceID, jobs.map((j) => j.jobId))
      : new Map<string, JobInfo>();
    const limits = s.fairShare && context.servicePodCount > 0
      ? await fairShareLimits(tx, serviceID, context.servicePodCount)
      : Object.create(null) as Record<string, number>;
    const isSync = (jobId: string): boolean => info.get(jobId)?.isAsync === false;

    // takes up to workSize work items from a job, within its user's fair share (unless ignoreShare)
    const take = async (jobId: string, workSize: number, ignoreShare = false): Promise<number> => {
      const user = info.get(jobId)?.username;
      let size = workSize;
      if (!ignoreShare && user !== undefined && !(s.syncExempt && isSync(jobId))) {
        size = Math.min(size, limits[user] ?? Infinity);
      }
      // slot-based asks for a job's slice even when it's 0, so only skip what the share cut to 0
      if (size <= 0 && size < workSize) return 0;
      const numTaken = await takeWorkItems(jobId, size);
      // a user's sync requests count towards their share too
      if (user !== undefined && limits[user] !== undefined) limits[user] -= numTaken;
      return numTaken;
    };

    let remainingBatchSize = batchSize;
    // fix 2: sync requests first, so a batch with room for one work item goes to the sync request
    let splitJobs = jobs;
    if (s.syncFirst) {
      for (const job of jobs) {
        if (isSync(job.jobId) && remainingBatchSize > 0) remainingBatchSize -= await take(job.jobId, remainingBatchSize);
      }
      splitJobs = jobs.filter((j) => !isSync(j.jobId));
    }

    // split evenly across the jobs, letting jobs later in the list use any share earlier ones
    // couldn't fill, as slot-based does
    let remainingNumOfJobs = splitJobs.length;
    for (const { jobId } of shuffleArray(splitJobs)) {
      const workSize = remainingNumOfJobs > 0 ? Math.ceil(remainingBatchSize / remainingNumOfJobs) : 1;
      remainingBatchSize -= await take(jobId, workSize);
      remainingNumOfJobs -= 1;
    }

    // fair share is work-conserving: what's left of the batch goes first to jobs still within
    // their user's share (a user below their share early in the split only got their slice),
    // and only what they can't take goes to the users held back, so it never leaves pods idle
    if (s.fairShare && remainingBatchSize > 0) {
      for (const ignoreShare of [false, true]) {
        for (const { jobId } of jobs) {
          if (remainingBatchSize <= 0) break;
          remainingBatchSize -= await take(jobId, remainingBatchSize, ignoreShare);
        }
      }
    }
  },
};
