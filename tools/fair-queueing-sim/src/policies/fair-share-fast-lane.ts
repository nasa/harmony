//
// fair-share-fast-lane: Harmony's fair share fast lane policy (fair-share-fast-lane-policy.ts in
// services/harmony/app/backends/workflow-orchestration, where the policy and its fixes are
// described), with the parts only the simulator has:
//
// - Fixes 2 and 5. They need durations Harmony doesn't keep, so here the policy keeps its own in
//   two columns it adds to user_work (setupFairShareFastLane), updated by its completion hook
//   (fairShareFastLaneWorkItemCompleted). In production that would take a migration and a
//   work-updater hook, and on the production scenarios they made no difference, so production's
//   policy ignores them and they're off by default here too. The columns keep fix 2's name,
//   adaptive_duration: its moving average adapts to recent work items.
// - The sampler, which records the fast lane state in each sample.
//

import type { CompletedWorkItem } from './index';
import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import {
  classificationBindings, classifiedCtes, createFairShareFastLanePolicy, fairShareFastLaneSettings, rawRows,
  usesOwnDurations,
} from '../../../../services/harmony/app/backends/workflow-orchestration/fair-share-fast-lane-policy';
import UserWork, { getSlowWorkCapacity } from '../../../../services/harmony/app/models/user-work';
import { WorkItemStatus } from '../../../../services/harmony/app/models/work-item-interface';
import { Transaction } from '../../../../services/harmony/app/util/db';
import schedulerEnv from '../../../../services/work-scheduler/app/util/env';

// Harmony's policy, with the duration columns setupFairShareFastLane adds, so fixes 2 and 5 work
export const fairShareFastLanePolicy: FairQueueingPolicy = createFairShareFastLanePolicy({ ownDurationColumns: true });

/**
 * Adds the policy's own duration columns to user_work: its measured duration for each (job,
 * service), and how many work items that's from. Kept apart from Harmony's average_duration,
 * which Harmony keeps up to date itself. (A migration in production.)
 *
 * @param tx - the database transaction
 */
export async function setupFairShareFastLane(tx: Transaction): Promise<void> {
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
export async function fairShareFastLaneWorkItemCompleted(tx: Transaction, workItem: CompletedWorkItem): Promise<void> {
  const s = fairShareFastLaneSettings();
  if (!usesOwnDurations(s)) return;
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
export async function sampleFairShareFastLane(
  tx: Transaction, serviceID: string, servicePodCount: number,
): Promise<Record<string, number>> {
  const s = fairShareFastLaneSettings();
  const slowCapacity = getSlowWorkCapacity(servicePodCount, s.reserveFraction ?? schedulerEnv.fastLaneReserveFraction);
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
