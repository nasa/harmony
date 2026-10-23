import { Logger } from 'winston';

import { DurationBasedFairQueueingOptions, getNextJobIds } from '../../models/user-work';
import { WorkItemStatus } from '../../models/work-item-interface';
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

export interface SchedulingContext {
  logger: Logger;
  // the number of pods currently running the service, when known
  servicePodCount?: number;
  // settings for duration based fair queueing, or undefined to use slot based fair queueing
  durationBasedOptions?: DurationBasedFairQueueingOptions;
}

export interface CompletedWorkItem {
  jobID: string;
  serviceID: string;
  workItemID: number;
  status: WorkItemStatus;
  // how long the work item took, as recorded on the work item - measured from when it was
  // queued, so it includes any time it spent waiting on the service queue
  durationMs: number;
  // how long the service pod reported the work item took to run, if it reported one
  serviceDurationMs?: number;
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

  /**
   * Optional hook called (in the work item update transaction) when a work item reaches a
   * completed state, for policies that keep their own state such as measured durations.
   *
   * @param tx - the work item update transaction
   * @param workItem - the completed work item
   */
  onWorkItemCompleted?(tx: Transaction, workItem: CompletedWorkItem): Promise<void>;
}

/**
 * Return a randomly shuffled list of the given list.
 * This is an implementation of the Fisher-Yates shuffle algorithm.
 *
 * Because the way we readjust the size of work items to retrieve for processing,
 * only the jobs at the back of the list can take advantage of the free slots left by
 * jobs in front. To avoid the situation where a fixed job list with small jobs
 * at the end preventing us from utilizing the full batch size, we randomly shuffle
 * the jobs in the list before looping through them.
 * This shuffle combined with multiple schedulers running in Harmony makes
 * available work items be retrieved for processing more promptly.
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
 * The current fair queueing algorithm: pick up to `batchSize` jobs interleaved round robin by
 * user (see getNextJobIds), shuffle them, then split the batch evenly across them, letting jobs
 * later in the list use any share that earlier jobs couldn't fill. Slot based unless
 * `context.durationBasedOptions` is set, in which case slow jobs also share whatever is left of
 * the service's slow work capacity (the fast lane reserve).
 */
export const baselinePolicy: FairQueueingPolicy = {
  name: 'baseline',

  async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
    const { jobs, availableSlowWorkSlots } = await getNextJobIds(
      tx, serviceID, batchSize, context.logger, context.durationBasedOptions);
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
};

let activePolicy: FairQueueingPolicy = baselinePolicy;

/**
 * Returns the fair queueing policy used to schedule work.
 *
 * @returns the active policy
 */
export function getFairQueueingPolicy(): FairQueueingPolicy {
  return activePolicy;
}

/**
 * Sets the fair queueing policy used to schedule work. Only the baseline policy is used in
 * deployed environments; this lets the fair queueing simulator (tools/fair-queueing-sim) try
 * alternatives.
 *
 * @param policy - the policy to use
 */
export function setFairQueueingPolicy(policy: FairQueueingPolicy): void {
  activePolicy = policy;
}
