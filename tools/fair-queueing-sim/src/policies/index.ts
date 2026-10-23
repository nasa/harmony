import { adaptiveFastLanePolicy, sampleAdaptiveFastLane } from './adaptive-fast-lane';
import { fastLaneReservePolicy, sampleFastLaneReserve } from './fast-lane-reserve';
import { POLICY_NAMES } from './names';
import {
  baselinePolicy, FairQueueingPolicy, setFairQueueingPolicy,
} from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import type { Transaction } from '../../../../services/harmony/app/util/db';

// Optional per-policy extra state to record in each sample, e.g. how much slow work is running
export type PolicySampler = (tx: Transaction, serviceID: string, servicePodCount: number) => Promise<Record<string, number>>;

// To add a policy: implement FairQueueingPolicy in this directory, add it here and add its name
// to names.ts
const POLICIES: Record<string, { policy: FairQueueingPolicy; sampler?: PolicySampler }> = {
  // Harmony's current algorithm (the production default)
  'baseline': { policy: baselinePolicy },
  // the algorithm from the harmony-2413 branch
  'fast-lane-reserve': { policy: fastLaneReservePolicy, sampler: sampleFastLaneReserve },
  // fast-lane-reserve plus fixes for the problems the simulator found with it
  'adaptive-fast-lane': { policy: adaptiveFastLanePolicy, sampler: sampleAdaptiveFastLane },
};

/**
 * Makes the named policy the one Harmony's scheduling code uses.
 *
 * @param name - the policy name
 * @returns a sampler for policy specific state, if the policy has one
 * @throws Error - if there is no policy with that name
 */
export function activatePolicy(name: string): PolicySampler | undefined {
  const entry = POLICIES[name];
  if (!entry || !POLICY_NAMES.includes(name)) {
    throw new Error(`Unknown fair queueing policy "${name}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  setFairQueueingPolicy(entry.policy);
  return entry.sampler;
}
