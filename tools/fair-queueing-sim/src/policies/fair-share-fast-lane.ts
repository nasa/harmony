//
// fair-share-fast-lane: Harmony's fair share fast lane policy (fair-share-fast-lane-policy.ts in
// services/harmony/app/backends/workflow-orchestration, where the policy is described), with the
// sampler, which records the fast lane state in each sample.
//

import {
  classificationBindings, classifiedCtes, fairShareFastLaneSettings, rawRows,
} from '../../../../services/harmony/app/backends/workflow-orchestration/fair-share-fast-lane-policy';
import { getSlowWorkCapacity } from '../../../../services/harmony/app/models/user-work';
import { Transaction } from '../../../../services/harmony/app/util/db';
import schedulerEnv from '../../../../services/work-scheduler/app/util/env';

export { fairShareFastLanePolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-share-fast-lane-policy';

/**
 * Records the fast lane state: slow work items running against the slow work capacity, whether
 * slow work is capped, how many (job, service)s are slow by their measured duration, how many
 * unmeasured work items are running, and how many (job, service)s are slow only because of a
 * long-running work item.
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
    WITH ${classifiedCtes()}
    SELECT
      SUM(CASE WHEN slow = 1 THEN running_count ELSE 0 END) AS slow_running,
      SUM(CASE WHEN slow = 0 AND duration IS NULL THEN running_count ELSE 0 END) AS unmeasured_running,
      COUNT(CASE WHEN slow = 1 AND duration IS NOT NULL THEN 1 END) AS slow_jobs,
      COUNT(CASE WHEN slow = 1 AND duration IS NULL THEN 1 END) AS long_running_jobs
    FROM Classified
  `, classificationBindings(serviceID, schedulerEnv.slowWorkThresholdMs)));
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
