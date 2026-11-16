import { Logger } from 'winston';

import { fairShareFastLanePolicy } from './fair-share-fast-lane-policy';
import { getNextJobIds, NextJob } from '../../models/user-work';
import { Transaction } from '../../util/db';

/**
 * Hands out up to `maxItems` ready work items for the given job to the service being scheduled,
 * updating all of the related bookkeeping (work item status, user_work counts).
 *
 * @param jobID - the job to take work items from
 * @param maxItems - the maximum number of work items to take
 * @returns the number of work items actually taken, which may be fewer than requested
 */
export type TakeWorkItems = (jobID: string, maxItems: number) => Promise<number>;

// What a policy is told about the service being scheduled. Each policy uses only the settings
// it needs - e.g. the slot based policy ignores the fast lane reserve settings.
export interface SchedulingContext {
  logger: Logger;
  // the number of pods currently running the service (its capacity)
  servicePodCount: number;
  // average work item duration (in ms) above which a job/service is slow
  slowWorkThresholdMs: number;
  // the fraction of the service's capacity reserved for fast work
  fastLaneReserveFraction: number;
}

/**
 * A fair queueing policy decides which jobs get work items, and how many, each time the
 * work-scheduler fills a service's queue. Policies only make decisions: taking the work items
 * and keeping user_work in sync is done by the `takeWorkItems` callback they are given, so a
 * policy can't leave the bookkeeping inconsistent.
 */
export interface FairQueueingPolicy {
  name: string;

  /**
   * Chooses up to `batchSize` work items for the service by calling `takeWorkItems` for each job
   * it picks, in priority order.
   *
   * @param tx - the scheduling transaction
   * @param serviceID - the service to schedule work for
   * @param batchSize - the maximum number of work items to take in total
   * @param context - information about the service being scheduled
   * @param takeWorkItems - takes work items from a job
   */
  scheduleWork(
    tx: Transaction,
    serviceID: string,
    batchSize: number,
    context: SchedulingContext,
    takeWorkItems: TakeWorkItems,
  ): Promise<void>;
}

/**
 * Return a randomly shuffled list of the given list.
 * This is an implementation of the Fisher-Yates shuffle algorithm.
 *
 * Because the way we readjust the size of work items to retrieve for processing,
 * only the jobs at the back of the list can take advantage of the free slots left by
 * jobs in front. To avoid the situation where a fixed job list with small jobs
 * at the end prevents us from utilizing the full batch size, we randomly shuffle
 * the jobs in the list before looping through them.
 * This shuffle combined with multiple schedulers running in Harmony
 * retrieves work items for processing more promptly.
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
 * Shuffles the jobs, then splits the batch evenly across them, letting jobs later in the list
 * use any share that earlier jobs couldn't fill. Slow jobs also share whatever is left of the
 * service's slow work capacity.
 *
 * @param jobs - the jobs to work, in fair queueing priority order
 * @param availableSlowWorkSlots - the number of work items that may be taken for slow jobs
 * @param batchSize - the maximum number of work items to take in total
 * @param takeWorkItems - takes work items from a job
 */
async function splitBatchAcrossJobs(
  jobs: NextJob[],
  availableSlowWorkSlots: number,
  batchSize: number,
  takeWorkItems: TakeWorkItems,
): Promise<void> {
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
}

/**
 * Slot based fair queueing (the default): up to `batchSize` jobs interleaved round robin by
 * user, with the users with the fewest running work items for the service first, and the batch
 * split evenly across them. See docs/fair-queueing.md.
 */
export const slotBasedPolicy: FairQueueingPolicy = {
  name: 'slot-based',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const { jobs, availableSlowWorkSlots } = await getNextJobIds(tx, serviceID, batchSize, context.logger);
    await splitBatchAcrossJobs(jobs, availableSlowWorkSlots, batchSize, takeWorkItems);
  },
};

/**
 * Duration based fair queueing (FAIR_QUEUEING_POLICY=duration-based): users are ranked by the
 * expected runtime of their work in progress for the service, and slow jobs may only use the
 * share of the service's pods not held back by the fast lane reserve. See docs/fair-queueing.md.
 */
export const durationBasedPolicy: FairQueueingPolicy = {
  name: 'duration-based',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const { servicePodCount, slowWorkThresholdMs, fastLaneReserveFraction } = context;
    const { jobs, availableSlowWorkSlots } = await getNextJobIds(
      tx, serviceID, batchSize, context.logger, { servicePodCount, slowWorkThresholdMs, fastLaneReserveFraction });
    await splitBatchAcrossJobs(jobs, availableSlowWorkSlots, batchSize, takeWorkItems);
  },
};

// The policies the work-scheduler can be configured to use, by their FAIR_QUEUEING_POLICY name.
// fairShareFastLanePolicy is in fair-share-fast-lane-policy.ts.
export const FAIR_QUEUEING_POLICIES: Record<string, FairQueueingPolicy> = {
  'slot-based': slotBasedPolicy,
  'duration-based': durationBasedPolicy,
  'fair-share-fast-lane': fairShareFastLanePolicy,
};

/**
 * Returns the fair queueing policy the work-scheduler is configured to use.
 *
 * @param name - the policy name (FAIR_QUEUEING_POLICY)
 * @param enableDurationBased - ENABLE_DURATION_BASED_FAIR_QUEUEING, the older setting, kept for
 * existing deployments: true selects duration-based unless `name` selects a policy other than
 * slot-based
 * @returns the policy
 * @throws Error - if there is no policy with that name
 */
export function getFairQueueingPolicy(name: string, enableDurationBased = false): FairQueueingPolicy {
  if (enableDurationBased && name === slotBasedPolicy.name) return durationBasedPolicy;
  const policy = FAIR_QUEUEING_POLICIES[name];
  if (!policy) {
    throw new Error(`Unknown fair queueing policy "${name}" - available policies: `
      + `${Object.keys(FAIR_QUEUEING_POLICIES).join(', ')}`);
  }
  return policy;
}
