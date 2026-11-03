import { NATIVE_POLICY, POLICY_NAMES } from './catalog';
import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import type { WorkItemStatus } from '../../../../services/harmony/app/models/work-item-interface';
import type { Transaction } from '../../../../services/harmony/app/util/db';

// Optional per-policy extra state to record in each sample, e.g. how much slow work is running
export type PolicySampler = (tx: Transaction, serviceID: string, servicePodCount: number) => Promise<Record<string, number>>;

// A work item that has reached a completed state, as given to onWorkItemCompleted
export interface CompletedWorkItem {
  jobID: string;
  serviceID: string;
  workItemID: number;
  status: WorkItemStatus;
  // the duration Harmony recorded for the work item (the longer of its own measurement, from when
  // a pod took the work item, and the one the pod reported)
  durationMs: number;
  // how long the service pod reported the work item took to run
  serviceDurationMs?: number;
}

export interface PolicyEntry {
  policy: FairQueueingPolicy;
  sampler?: PolicySampler;
  // Called once, after the database is created and before anything is scheduled, for a policy
  // that keeps state of its own (e.g. adds its own columns)
  setup?: (tx: Transaction) => Promise<void>;
  // Called in the work item update transaction whenever a work item reaches a completed state
  // (successful, warning, failed after its retries or canceled), for a policy that learns from
  // completed work - e.g. its own measure of how long a job's work items take. Simulator only for
  // now: FairQueueingPolicy has no such hook, so a policy that needs it in production needs one
  // added there (called from the work-updater) when it's promoted.
  onWorkItemCompleted?: (tx: Transaction, workItem: CompletedWorkItem) => Promise<void>;
}

/**
 * Returns the implementations of the policies. Loaded on demand rather than imported at the top
 * of the file so that "native" runs work against Harmony code without the policy interface (e.g.
 * an older branch, when checking a policy here against the original).
 *
 * @returns the policies and their samplers, by name
 */
async function loadPolicies(): Promise<Record<string, PolicyEntry>> {
  const { durationBasedPolicy, slotBasedPolicy } = await import('../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy');
  const {
    adaptiveFastLanePolicy, adaptiveWorkItemCompleted, sampleAdaptiveFastLane, setupAdaptiveFastLane,
  } = await import('./adaptive-fast-lane');
  // To add a policy: implement FairQueueingPolicy in this directory, add it here and describe it
  // in catalog.ts
  return {
    // Harmony's default algorithm
    'slot-based': { policy: slotBasedPolicy },
    // Harmony's algorithm when ENABLE_DURATION_BASED_FAIR_QUEUEING is true
    'duration-based': { policy: durationBasedPolicy },
    // duration-based plus fixes for the problems the simulator found with it
    'adaptive-fast-lane': {
      policy: adaptiveFastLanePolicy,
      sampler: sampleAdaptiveFastLane,
      setup: setupAdaptiveFastLane,
      onWorkItemCompleted: adaptiveWorkItemCompleted,
    },
  };
}

/**
 * Returns the named policy, for the harness to use in place of the one the work-scheduler picks.
 * The "native" policy returns nothing, leaving whatever scheduling code the checked out Harmony
 * has built in.
 *
 * @param name - the policy name
 * @returns the policy and its sampler, or undefined for the native policy
 * @throws Error - if there is no policy with that name
 */
export async function loadPolicy(name: string): Promise<PolicyEntry | undefined> {
  if (name === NATIVE_POLICY) return undefined;
  const entry = (await loadPolicies())[name];
  if (!entry || !POLICY_NAMES.includes(name)) {
    throw new Error(`Unknown fair queueing policy "${name}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  return entry;
}
