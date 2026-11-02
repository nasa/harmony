import { NATIVE_POLICY, POLICY_NAMES } from './catalog';
import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import type { Transaction } from '../../../../services/harmony/app/util/db';

// Optional per-policy extra state to record in each sample, e.g. how much slow work is running
export type PolicySampler = (tx: Transaction, serviceID: string, servicePodCount: number) => Promise<Record<string, number>>;

export interface PolicyEntry {
  policy: FairQueueingPolicy;
  sampler?: PolicySampler;
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
  // To add a policy: implement FairQueueingPolicy in this directory, add it here and describe it
  // in catalog.ts
  return {
    // Harmony's default algorithm
    'slot-based': { policy: slotBasedPolicy },
    // Harmony's algorithm when ENABLE_DURATION_BASED_FAIR_QUEUEING is true
    'duration-based': { policy: durationBasedPolicy },
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
