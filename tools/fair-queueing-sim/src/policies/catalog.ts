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
      'FAIR_QUEUEING_POLICY is duration-based): users ranked by the expected runtime of their in-progress ' +
      'work for the service, and the fast lane reserve.',
    designNotes: [FAST_LANE_DESIGN_NOTE],
    settings: FAST_LANE_SETTINGS,
  },
  'slot-based-fair-share': {
    description: 'slot-based plus the two fixes from fair-share-fast-lane that need no work item durations: each user held ' +
      'to their max-min fair share of the pods while another user below theirs has work ready (work-conserving), ' +
      'and sync requests first, never held back by fair share. No durations, schema change, work-updater hook or ' +
      'fast lane reserve.',
    settings: [
      {
        env: 'SLOT_BASED_FAIR_SHARE',
        default: 'true',
        description: 'while another user below their fair share of the pods has work ready, hold each user to theirs',
      },
      {
        env: 'SLOT_BASED_SYNC_EXEMPT',
        default: 'true',
        description: "fair share never holds back a sync request (it still counts towards its user's share)",
      },
      {
        env: 'SLOT_BASED_SYNC_FIRST',
        default: 'true',
        description: 'each scheduling batch goes to sync requests first, before it is split between jobs',
      },
    ],
    variants: [
      { name: 'no-fair-share', description: 'fair share off', set: { SLOT_BASED_FAIR_SHARE: 'false' } },
      { name: 'no-sync-exempt', description: 'without exempting sync requests from fair share', set: { SLOT_BASED_SYNC_EXEMPT: 'false' } },
      { name: 'no-sync-first', description: 'without giving sync requests the batch first', set: { SLOT_BASED_SYNC_FIRST: 'false' } },
    ],
    equivalentTo: {
      policy: 'slot-based',
      set: { SLOT_BASED_FAIR_SHARE: 'false', SLOT_BASED_SYNC_EXEMPT: 'false', SLOT_BASED_SYNC_FIRST: 'false' },
      description: "with all three switched off, slot-based-fair-share must make exactly the same decisions as Harmony's slot-based",
    },
  },
  'fair-share-fast-lane': {
    description: "Harmony's fair share fast lane (fairShareFastLanePolicy in fair-share-fast-lane-policy.ts, used when " +
      'FAIR_QUEUEING_POLICY is fair-share-fast-lane; called adaptive-fast-lane until 2026-11-10): duration-based, with ' +
      'a 10% reserve instead of 30%, plus fixes: a ' +
      'limit on running work for unmeasured jobs, a service-level estimate for unmeasured work, per-user batch ' +
      'splitting, every user held to their fair share while others wait, unmeasured work treated as slow (keeping ' +
      'its limit) once a work item has been running longer than the threshold, and sync requests first, never held ' +
      'back by fair share. Two more fixes (a moving average of recent durations, pod-reported durations) are off by ' +
      "default and simulator only: they need durations Harmony doesn't keep, and made no difference on the " +
      'production scenarios.',
    designNotes: [FAST_LANE_DESIGN_NOTE],
    // defaults from the work-scheduler's env-defaults, except fixes 2 and 5's, which aren't there
    settings: [
      ...FAST_LANE_SETTINGS,
      {
        env: 'FAIR_SHARE_FAST_LANE_RESERVE_FRACTION',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_RESERVE_FRACTION'),
        description: "fraction of a service's pods slow work may never use ('scheduler' = the work-scheduler's " +
          'FAST_LANE_RESERVE_FRACTION, as duration-based uses)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT'),
        description: 'most work items that may run for a (job, service) before it has a measured duration (0 = no limit)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION'),
        description: 'beyond the unmeasured limit, all unmeasured work on the service together may run up to this fraction ' +
          'of the slow work capacity, sharing it with slow work so the reserve stays free (0 = just the limit)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_EWMA_ALPHA',
        default: '0',
        description: 'fix 2: weight of the newest work item in a moving average of durations (0 = off: Harmony\'s ' +
          'mean over the job\'s lifetime; 0.2 was the default before it was switched off)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_UNMEASURED_ESTIMATE',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_UNMEASURED_ESTIMATE'),
        description: "'service' = unmeasured work counts as the service's mean measured duration; 'fixed' = the default below",
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_UNMEASURED_DEFAULT_MS',
        // DEFAULT_EXPECTED_DURATION_MS in user-work.ts, which duration-based uses
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_UNMEASURED_DEFAULT_MS'),
        description: 'expected duration of unmeasured work when there is nothing better to go on',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_SPLIT_BY_USER',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_SPLIT_BY_USER'),
        description: 'split each batch between users first (false = evenly per job)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION',
        default: 'false',
        description: "fix 5: use the duration the service pod reports (false = off: Harmony's, which can include queue wait)",
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_SLOW_FAIR_SHARE',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_SLOW_FAIR_SHARE'),
        description: "while other users' fast work is ready, hold a user's slow work to their fair share of the pods",
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE'),
        description: 'treat an unmeasured (job, service) as slow while one of its work items has been running longer than the threshold',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_FAIR_SHARE_ALL',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_FAIR_SHARE_ALL'),
        description: 'fix 6 holds every user to their fair share while another user below theirs has work ready, not just slow users',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT'),
        description: "fix 7: unmeasured work it shows is slow keeps fix 1's limits until it's measured " +
          '(false = it moves from them to the larger slow work capacity)',
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_SYNC_EXEMPT',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_SYNC_EXEMPT'),
        description: "fix 8: fix 6 never holds back a sync request (it still counts towards its user's share)",
      },
      {
        env: 'FAIR_SHARE_FAST_LANE_SYNC_FIRST',
        default: workSchedulerDefault('FAIR_SHARE_FAST_LANE_SYNC_FIRST'),
        description: 'fix 8: each scheduling batch goes to sync requests first, before it is split between users',
      },
    ],
    variants: [
      { name: 'scheduler-reserve', description: "the work-scheduler's reserve (30%) instead of 10%", set: { FAIR_SHARE_FAST_LANE_RESERVE_FRACTION: 'scheduler' } },
      { name: 'no-unmeasured-limit', description: 'fix 1 (unmeasured work limit) off', set: { FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT: '0' } },
      { name: 'no-unmeasured-fraction', description: 'fix 1 without the shared fraction (just the limit)', set: { FAIR_SHARE_FAST_LANE_UNMEASURED_FRACTION: '0' } },
      { name: 'with-moving-average', description: 'fix 2 (moving average, weight 0.2) on', set: { FAIR_SHARE_FAST_LANE_EWMA_ALPHA: '0.2' } },
      { name: 'no-service-estimate', description: 'fix 3 (service estimate for unmeasured work) off', set: { FAIR_SHARE_FAST_LANE_UNMEASURED_ESTIMATE: 'fixed' } },
      { name: 'no-split-by-user', description: 'fix 4 (per-user batch split) off', set: { FAIR_SHARE_FAST_LANE_SPLIT_BY_USER: 'false' } },
      { name: 'with-service-duration', description: 'fix 5 (pod-reported durations) on', set: { FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION: 'true' } },
      { name: 'no-slow-fair-share', description: 'fix 6 (slow work held to fair share) off', set: { FAIR_SHARE_FAST_LANE_SLOW_FAIR_SHARE: 'false' } },
      { name: 'no-fair-share-all', description: 'fix 6 for slow users only', set: { FAIR_SHARE_FAST_LANE_FAIR_SHARE_ALL: 'false' } },
      { name: 'no-running-evidence', description: 'fix 7 (long-running work is slow) off', set: { FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE: 'false' } },
      { name: 'no-keeps-limit', description: "fix 7 without keeping fix 1's limits", set: { FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT: 'false' } },
      { name: 'no-sync-exempt', description: 'fix 8 without exempting sync requests from fair share', set: { FAIR_SHARE_FAST_LANE_SYNC_EXEMPT: 'false' } },
      { name: 'no-sync-first', description: 'fix 8 without giving sync requests the batch first', set: { FAIR_SHARE_FAST_LANE_SYNC_FIRST: 'false' } },
    ],
    equivalentTo: {
      policy: 'duration-based',
      set: {
        FAIR_SHARE_FAST_LANE_RESERVE_FRACTION: 'scheduler',
        FAIR_SHARE_FAST_LANE_UNMEASURED_LIMIT: '0',
        FAIR_SHARE_FAST_LANE_EWMA_ALPHA: '0',
        FAIR_SHARE_FAST_LANE_UNMEASURED_ESTIMATE: 'fixed',
        FAIR_SHARE_FAST_LANE_SPLIT_BY_USER: 'false',
        FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION: 'false',
        FAIR_SHARE_FAST_LANE_SLOW_FAIR_SHARE: 'false',
        FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE: 'false',
        FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT: 'false',
        FAIR_SHARE_FAST_LANE_SYNC_EXEMPT: 'false',
        FAIR_SHARE_FAST_LANE_SYNC_FIRST: 'false',
      },
      description: 'with all eight fixes switched off and the work-scheduler\'s reserve, fair-share-fast-lane must make exactly the same decisions as Harmony\'s duration-based',
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
