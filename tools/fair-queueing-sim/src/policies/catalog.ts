//
// The fair queueing policies the simulator can run, with their settings and the checks the
// `findings` command runs for them. Kept separate from the policy implementations (index.ts) so
// the CLI can use it without loading any Harmony code.
//

import * as fs from 'fs';
import * as path from 'path';

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

const WORK_SCHEDULER_ENV_DEFAULTS = path.resolve(__dirname, '../../../../services/work-scheduler/env-defaults');

/**
 * Returns the work-scheduler's default for one of its settings, so the settings recorded for a
 * run are the ones it actually used.
 *
 * @param key - the environment variable
 * @returns the default value from services/work-scheduler/env-defaults, or 'unset' if it has
 * none (e.g. an older checkout run by `findings --references`)
 */
function workSchedulerDefault(key: string): string {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(fs.readFileSync(WORK_SCHEDULER_ENV_DEFAULTS, 'utf8'));
  return match ? match[1].trim() : 'unset';
}

const FAST_LANE_SETTINGS: PolicySetting[] = [
  {
    env: 'SLOW_WORK_THRESHOLD_MS',
    default: workSchedulerDefault('SLOW_WORK_THRESHOLD_MS'),
    description: 'a (job, service) whose measured work item duration is above this is "slow"',
  },
  {
    env: 'FAST_LANE_RESERVE_FRACTION',
    default: workSchedulerDefault('FAST_LANE_RESERVE_FRACTION'),
    description: "fraction of a service's pods that slow work may never use",
  },
];

const FAST_LANE_DESIGN_NOTE = 'The fast lane reserve is intentional: slow work may never use more than ' +
  '(1 - FAST_LANE_RESERVE_FRACTION) of a service\'s pods, even when no other work is waiting, because ' +
  'Harmony has seen slow jobs take every pod and leave newly arriving fast jobs unworked. Pods left ' +
  'idle by the reserve when only slow work exists (e.g. story 07) are the accepted cost of that ' +
  'guarantee, not a bug.';

export const POLICY_CATALOG: Record<string, PolicyInfo> = {
  'slot-based': {
    description: "Harmony's default algorithm (slotBasedPolicy in fair-queueing-policy.ts): up to batchSize jobs " +
      'interleaved round robin by user, users with the fewest running work items for the service first, ' +
      'shuffled, with the batch split evenly per job. No knowledge of work item durations.',
    settings: [],
  },
  'duration-based': {
    description: "Harmony's duration based algorithm (durationBasedPolicy in fair-queueing-policy.ts, used when " +
      'ENABLE_DURATION_BASED_FAIR_QUEUEING is true): users ranked by the expected runtime of their in-progress ' +
      'work for the service, and the fast lane reserve.',
    designNotes: [FAST_LANE_DESIGN_NOTE],
    settings: FAST_LANE_SETTINGS,
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
