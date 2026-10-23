import { NATIVE_POLICY, POLICY_NAMES } from './catalog';
import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import type { Transaction } from '../../../../services/harmony/app/util/db';

// Optional per-policy extra state to record in each sample, e.g. how much slow work is running
export type PolicySampler = (tx: Transaction, serviceID: string, servicePodCount: number) => Promise<Record<string, number>>;

/**
 * Returns the implementations of the policies. Loaded on demand rather than imported at the top
 * of the file so that "native" runs work against Harmony code without the policy seam (e.g. an
 * older branch, when checking a ported policy against the original).
 *
 * @returns the policies and their samplers, by name
 */
async function loadPolicies(): Promise<Record<string, { policy: FairQueueingPolicy; sampler?: PolicySampler }>> {
  const { baselinePolicy } = await import('../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy');
  const { fastLaneReservePolicy, sampleFastLaneReserve } = await import('./fast-lane-reserve');
  const { adaptiveFastLanePolicy, sampleAdaptiveFastLane } = await import('./adaptive-fast-lane');
  // To add a policy: implement FairQueueingPolicy in this directory, add it here and describe it
  // in catalog.ts
  return {
    // Harmony's current algorithm (the production default)
    'baseline': { policy: baselinePolicy },
    // the algorithm from the harmony-2413 branch
    'fast-lane-reserve': { policy: fastLaneReservePolicy, sampler: sampleFastLaneReserve },
    // fast-lane-reserve plus fixes for the problems the simulator found with it
    'adaptive-fast-lane': { policy: adaptiveFastLanePolicy, sampler: sampleAdaptiveFastLane },
  };
}

/**
 * Makes the named policy the one Harmony's scheduling code uses. The "native" policy installs
 * nothing, leaving whatever scheduling code the checked out Harmony has built in.
 *
 * @param name - the policy name
 * @returns a sampler for policy specific state, if the policy has one
 * @throws Error - if there is no policy with that name
 */
export async function activatePolicy(name: string): Promise<PolicySampler | undefined> {
  if (name === NATIVE_POLICY) return undefined;
  const entry = (await loadPolicies())[name];
  if (!entry || !POLICY_NAMES.includes(name)) {
    throw new Error(`Unknown fair queueing policy "${name}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  const { setFairQueueingPolicy } = await import('../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy');
  setFairQueueingPolicy(entry.policy);
  return entry.sampler;
}
