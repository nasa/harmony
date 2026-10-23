// The fair queueing policies the simulator can run. Kept separate from the policy
// implementations so the CLI can list them without loading any Harmony code.
export const POLICY_NAMES = ['baseline', 'fast-lane-reserve', 'adaptive-fast-lane'];
