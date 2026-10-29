//
// The fair queueing policies the simulator can run, with their settings and the checks the
// `findings` command runs for them. Kept separate from the policy implementations (index.ts) so
// the CLI can use it without loading any Harmony code.
//

export interface PolicySetting {
  // environment variable the policy reads
  env: string;
  // the value used when the variable isn't set
  default: string;
  description: string;
}

export interface PolicyVariant {
  name: string;
  description: string;
  // environment overrides that produce the variant
  set: Record<string, string>;
}

export interface PolicyInfo {
  description: string;
  // design decisions to keep in mind when interpreting this policy's results
  designNotes?: string[];
  settings: PolicySetting[];
  // for findings: variants that each switch off one feature, to show what each contributes
  variants?: PolicyVariant[];
  // for findings: settings under which this policy must make exactly the same decisions as
  // another policy
  equivalentTo?: { policy: string; set: Record<string, string>; description: string };
}

const FAST_LANE_SETTINGS: PolicySetting[] = [
  {
    env: 'SLOW_WORK_THRESHOLD_MS',
    default: '600000',
    description: 'a (job, service) whose measured work item duration is above this is "slow"',
  },
  {
    env: 'FAST_LANE_RESERVE_FRACTION',
    default: '0.3',
    description: "fraction of a service's pods that slow work may never use",
  },
];

const FAST_LANE_DESIGN_NOTE = 'The fast lane reserve is intentional: slow work may never use more than ' +
  '(1 - FAST_LANE_RESERVE_FRACTION) of a service\'s pods, even when no other work is waiting, because ' +
  'Harmony has seen slow jobs take every pod and leave newly arriving fast jobs unworked. Pods left ' +
  'idle by the reserve when only slow work exists (e.g. story 07) are the accepted cost of that ' +
  'guarantee, not a bug.';

const ADAPTIVE_OFF: Record<string, string> = {
  ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT: '0',
  ADAPTIVE_FAST_LANE_EWMA_ALPHA: '0',
  ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE: 'fixed',
  ADAPTIVE_FAST_LANE_SPLIT_BY_USER: 'false',
  ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION: 'false',
  ADAPTIVE_FAST_LANE_SLOW_FAIR_SHARE: 'false',
  ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE: 'false',
};

export const POLICY_CATALOG: Record<string, PolicyInfo> = {
  'baseline': {
    description: "Harmony's current algorithm (baselinePolicy in fair-queueing-policy.ts): up to batchSize jobs " +
      'interleaved round robin by user, oldest-worked first, shuffled, with the batch split evenly per job. ' +
      'No knowledge of work item durations.',
    settings: [],
  },
  'fast-lane-reserve': {
    description: 'The algorithm from the harmony-2413 branch: users ranked by the expected runtime of their ' +
      "in-progress work, a user's sync jobs before their async ones, and the fast lane reserve.",
    designNotes: [FAST_LANE_DESIGN_NOTE],
    settings: FAST_LANE_SETTINGS,
  },
  'adaptive-fast-lane': {
    description: 'fast-lane-reserve, with the same reserve, plus seven fixes: a limit on running work for ' +
      'unmeasured jobs, a moving average of recent durations, a service-level estimate for unmeasured work, ' +
      'per-user batch splitting, pod-reported durations, slow work held to its fair share while fast work waits, ' +
      'and work treated as slow once a work item has been running longer than the threshold.',
    designNotes: [FAST_LANE_DESIGN_NOTE],
    settings: [
      ...FAST_LANE_SETTINGS,
      {
        env: 'ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT',
        default: '2',
        description: 'most work items that may run for a (job, service) before its first one completes (0 = no limit)',
      },
      {
        env: 'ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION',
        default: '0.5',
        description: 'beyond the unmeasured limit, all unmeasured work on the service together may run up to this fraction ' +
          'of the slow work capacity, sharing it with slow work so the reserve stays free (0 = just the limit)',
      },
      {
        env: 'ADAPTIVE_FAST_LANE_EWMA_ALPHA',
        default: '0.2',
        description: 'weight of the newest work item in the moving average (0 = mean over the job\'s lifetime)',
      },
      {
        env: 'ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE',
        default: 'service',
        description: "'service' = unmeasured work counts as the service's mean measured duration; 'fixed' = the default below",
      },
      {
        env: 'ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS',
        default: '3600000',
        description: 'expected duration of unmeasured work when there is nothing better to go on',
      },
      {
        env: 'ADAPTIVE_FAST_LANE_SPLIT_BY_USER',
        default: 'true',
        description: 'split each batch between users first (false = evenly per job)',
      },
      {
        env: 'ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION',
        default: 'true',
        description: "use the duration the service pod reports (false = Harmony's, which includes queue wait)",
      },
      {
        env: 'ADAPTIVE_FAST_LANE_SLOW_FAIR_SHARE',
        default: 'true',
        description: "while other users' fast work is ready, hold a user's slow work to their fair share of the pods",
      },
      {
        env: 'ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE',
        default: 'true',
        description: 'treat a (job, service) as slow while one of its work items has been running longer than the threshold',
      },
    ],
    variants: [
      { name: 'no-unmeasured-limit', description: 'fix 1 (unmeasured work limit) off', set: { ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT: '0' } },
      { name: 'no-unmeasured-fraction', description: 'fix 1 without the shared fraction (just the limit)', set: { ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION: '0' } },
      { name: 'no-moving-average', description: 'fix 2 (moving average) off', set: { ADAPTIVE_FAST_LANE_EWMA_ALPHA: '0' } },
      { name: 'no-service-estimate', description: 'fix 3 (service estimate for unmeasured work) off', set: { ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE: 'fixed' } },
      { name: 'no-split-by-user', description: 'fix 4 (per-user batch split) off', set: { ADAPTIVE_FAST_LANE_SPLIT_BY_USER: 'false' } },
      { name: 'no-service-duration', description: 'fix 5 (pod-reported durations) off', set: { ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION: 'false' } },
      { name: 'no-slow-fair-share', description: 'fix 6 (slow work held to fair share) off', set: { ADAPTIVE_FAST_LANE_SLOW_FAIR_SHARE: 'false' } },
      { name: 'no-running-evidence', description: 'fix 7 (long-running work is slow) off', set: { ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE: 'false' } },
    ],
    equivalentTo: {
      policy: 'fast-lane-reserve',
      set: ADAPTIVE_OFF,
      description: 'with all seven fixes switched off, adaptive-fast-lane must make exactly the same decisions as fast-lane-reserve',
    },
  },
};

export const POLICY_NAMES = Object.keys(POLICY_CATALOG);

// Runs with this "policy" install no policy at all and run whatever scheduling code the checked
// out Harmony has built in - used to check the simulator's policies against other branches
export const NATIVE_POLICY = 'native';

/**
 * Returns the value of each of a policy's settings in the given environment.
 *
 * @param name - the policy name
 * @param env - the environment (defaults to process.env)
 * @returns the setting values, by environment variable
 */
export function resolvedSettings(name: string, env: Record<string, string> = process.env): Record<string, string> {
  return Object.fromEntries((POLICY_CATALOG[name]?.settings || []).map((s) => [s.env, env[s.env] ?? s.default]));
}
