# Fair queueing policy design

Why `adaptive-fast-lane` (`src/policies/adaptive-fast-lane.ts`) is built the way it is: the
problem each fix solves, the evidence for it, the trade-offs chosen and the alternatives that were
rejected. What each fix does, and its settings, are in the code's header comment and in
[REFERENCE.md](REFERENCE.md#available-policies); this file is the reasoning behind them.

`adaptive-fast-lane` is a candidate replacement for Harmony's `duration-based` policy. It runs in
the simulator only, until it's [promoted](README.md#6-promote-it-to-production).

- [Ground rules](#ground-rules)
- [Results](#results)
- [The fixes](#the-fixes)
- [Judgment calls](#judgment-calls)
- [Considered and not done](#considered-and-not-done)
- [Before promoting it](#before-promoting-it)
- [Reproducing the evidence](#reproducing-the-evidence)

## Ground rules

Every decision below keeps to these:

- **The fast lane reserve is intentional.** Slow work never uses more than
  `1 - FAST_LANE_RESERVE_FRACTION` of a service's pods, even when nothing else is waiting, because
  Harmony has seen slow jobs take every pod and leave arriving fast jobs unworked. Pods the reserve
  leaves idle (story 07) are the cost of that guarantee, so no fix lets slow work into the reserve.
- **It's `duration-based` plus fixes.** The queries follow `getNextJobIdsDurationBased` step for
  step, and with every fix switched off the policy makes exactly the same decisions as
  `duration-based`, which `findings` checks in every story. So every difference in the results
  comes from a fix, and each fix can be judged by switching it off.
- **It keeps its own durations.** Fixes 2 and 5 need durations Harmony doesn't keep, so the policy
  stores them in its own `user_work` columns (`adaptive_duration`, `adaptive_count`). Harmony's
  `average_duration` is left alone, so switching between the policies never leaves either one
  reading the other's values.
- **Judged on the stories' protected metrics, over 5 seeds** (the stories and their goals are
  set out for review in [SCENARIOS.md](SCENARIOS.md)). A difference counts when it holds
  in every seed (each seed has the same work item durations under every policy). The single-seed
  feature table from `findings` shows which fix causes what, but its small effects are noise.

## Results

Against `duration-based`, from the benchmark records (12 stories, seeds 101-105):

- **Better in every seed on 15 of the 24 protected metrics:** contended fairness in 03, 04 (+11%),
  08 (+31%) and 11; the newcomer in 05 (-33% slowdown); the fast users in 06 (-57%), 11 (-58%) and
  12 (-67%); Judy's share in 08 (0.40 -> 0.95); Nora in 12; Lee in 09 (-86%).
- **Sync requests** in 02, 03, 04 and 10 are 3-21% faster on average, but not in every seed.
- **Worse in every seed in three places**, all expected costs:
  - 01's utilization -1.5%, and a 1 hour job alone or nearly alone (01, 02, 10) +1.5% (about a
    minute): fix 1 holds a new job to 2 work items until its first one finishes.
  - 07's slow job alone +10%: fix 1 and the reserve hold from the start, where `duration-based`
    lets unmeasured slow work overshoot the reserve before it's measured.

On `scenarios/mixed-workload.yml` (six hours of random arrivals from five users across a two step
chain, which none of the fixes were tuned on; seeds 101-103), it is better in all 3 seeds on every
headline metric: mean job slowdown -30%, worst slowdown -37%, mean sync makespan -31% (worst -50%),
contended fairness +10%, for -0.1% utilization. One viewer's sync requests are about 7 seconds
slower in every seed.

## The fixes

Feature table numbers are mean job slowdown from `findings` (one seed, all other fixes on);
everything else is over 5 seeds.

1. **Unmeasured work limit.** *Problem:* `duration-based` only knows work is slow once a work
   item finishes, so a new slow job fills the service first (story 06: slow work in flight peaks
   above the cap). *Decision:* a new (job, service) may run 2 work items until it's measured, plus
   a shared allowance for all unmeasured work (half the slow work capacity) that counts against
   the slow work capacity, so it never takes the reserve. *Evidence:* it produces the 06 win (off:
   slowdown 3.57 vs 2.74, fairness 0.78 vs 0.97) and helps 10 and 11. *Cost:* all of 01, 02 and
   07's costs above - switched off, 01 and 07 match `duration-based` exactly.
2. **Moving average.** *Problem:* a lifetime mean hides a job whose work items slow down part
   way through (story 09: Kim is never classified slow). *Decision:* an exponentially weighted
   moving average, weight 0.2 on the newest item. *Evidence:* off, 09 goes from 3.04 to 3.55; fix 6
   now does most of what this used to.
3. **Service estimate for unmeasured work.** *Problem:* `duration-based` ranks unmeasured work as
   an hour long, pushing new jobs back. *Decision:* use the service's mean measured duration.
   *Evidence:* small and mixed (helps 09; may slow 04's sync request) - optional.
4. **Per-user batch split.** *Problem:* splitting each batch evenly per job gives a user with
   many jobs more of the service (story 08). *Decision:* split between users, then their jobs.
   *Evidence:* off, 08 goes from 4.13 to 4.39 (5-seed records: Judy's share 0.40 -> 0.95 with
   fixes 4 and 6 together).
5. **Pod-reported durations.** *Problem:* Harmony's duration includes time a work item waited
   on a pod before running. *Decision:* use the pod's own timing. *Evidence:* none either way - no
   story backs up the queue enough for the two to differ. Kept because it measures the right
   thing; judge it with a scenario that does.
6. **Fair share while others wait.** *Problem:* a slow user refills every pod they free up, up to
   the slow work capacity, so backed up fast users share only the reserve. *Decision:* while
   another user below their max-min fair share has work ready, each user only gets new work items
   while below their own share; nothing running is interrupted, and whatever the others can't
   take goes to the users held back, so it never leaves pods idle. *Evidence:* the biggest single
   fix - off, 04 goes from 5.86 to 6.72, 06 from 2.74 to 3.96, 09 from 3.04 to 9.72 and 12 from
   2.67 to 4.97. Holding every user to their share, not just slow users (`FAIR_SHARE_ALL`), is
   what helps 04 and 12.
7. **Long-running work is slow before it finishes.** *Problem:* until a work item completes,
   fix 1 can't tell a 30 minute work item from a slow-to-start one. *Decision:* a (job, service)
   with a work item running longer than the threshold is slow from then on, and keeps fix 1's
   limits until it's measured - see [judgment calls](#judgment-calls). *Evidence:* in the stories
   it makes no difference to fix 7 off; it keeps the policy's protection of fast work from
   depending on `SLOW_WORK_THRESHOLD_MS` (weekend experiments, on the earlier base).
8. **Sync requests first.** *Problem:* with `FAIR_SHARE_ALL`, a sync request waits behind its
   own user's async work once that fills the user's share (story 03), and when a pod frees up a
   batch may only have room for one work item, which the per-user split gives anyone.
   *Decision:* fix 6 never holds back a sync request (it still counts towards the user's share),
   and sync requests get each batch first. Production limits sync requests to one granule
   (`MAX_SYNCHRONOUS_GRANULES`), so they can't crowd out async work. *Evidence:* story 03's sync
   request -28% (better in 4 seeds, none worse), 04's -16% (5/5). No other protected metric moves
   but 04's fairness (-0.1%); big async jobs in 03 and 04 take 0.2-1% longer.

## Judgment calls

- **Fix 7 keeps fix 1's limits** (`ADAPTIVE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT=true`).
  Without that, noticing that new work is slow moved it from fix 1's limits to the larger slow
  work capacity, so being noticed *loosened* its limit. With it: story 11's fast job -33% (5/5),
  for 11's fairness -1.5% (0/5), 07's slow job +2.9% (0/5) and one of 06's fast users +1.1% (1/4).
  Story 11's goal puts the fast job first ("Gina's fast work starts promptly ... Frank and Mia
  finishing later is the expected price"), hence the default. Read the story as "fair from the
  start" instead and set it to `false`.
- **Accepting the costs in 01, 02, 07 and 10.** They're the price of fix 1 and the reserve:
  limiting new work until it's measured is what stops a new slow job filling the service, and no
  version of fix 1 tried avoids both.
- **Fix 1's shared allowance** (`UNMEASURED_FRACTION=0.5`). With just the per-job limit, the
  single-seed table shows lower slowdowns in 06, 11 and 12 but lower fairness there, and 07 and 10
  get worse. 0.5 was as good as anything nearby in a sweep on the earlier base (with the limit and
  the moving average weight); it hasn't been re-swept since fixes 7 and 8 changed.

## Considered and not done

- **Exempting sync requests from fix 1.** Fix 1 looked like the cause of slower sync requests in
  02-04, but production's 1-granule sync requests never reach its per-job limit of 2. The delay was
  fix 6's, which is what fix 8 addresses.
- **Switching fix 7 off.** Indistinguishable from fix 7 with its limits kept in the stories; kept
  for the threshold independence above.
- **Letting slow work use the reserve when nothing else is waiting.** Rejected by the ground rules.
- **A catch-up boost (weekend fix 9).** Weights fix 6's shares by how little of the service each
  user has had lately, so a newcomer gets going faster (05 is the one story no policy meets). On
  the earlier base it made 05's newcomer 26% faster. Not yet re-done on this base. If it is: track
  recent use as a decayed integral of running work items, not from `work_items` start and end
  times, which miss failed and retried attempts and make a flaky user look light. The integral
  lives in each scheduler pod's memory, so a restart means equal shares until it builds up again.
- **Preemption.** A user who is correctly "fast" and alone takes every pod; if their work then
  turns slow, a newcomer waits for a pod to free up (story 09, seed 104). No policy without
  preemption can fix that, and preempting running work items is out of scope.

## Before promoting it

See the README's [promotion steps](README.md#6-promote-it-to-production). Specific to this policy:

- **The completion hook moves into the work-updater.** Fixes 2 and 5 learn from completed work
  items through `onWorkItemCompleted`, which only the simulator calls. Production needs it in the
  work-updater's transaction, which means extending the policy interface.
- **A migration for its columns**, replacing the simulator's `setup`.
- **Postgres-only paths are untested here.** The advisory lock and `SKIP LOCKED` that serialize
  concurrent scheduler pods never run in the simulator (sqlite, one event at a time). A sandbox
  deployment is the first real test of them.
- **Fix 5 needs a scenario that backs up the service queue** before it can be judged.

## Reproducing the evidence

```fish
# the 5-seed comparison with duration-based and slot-based (bench.md)
npm run sim -- bench

# what each fix contributes, and the duration-based equivalence check (findings.md)
npm run sim -- findings scenarios/stories/*.yml --policies duration-based,adaptive-fast-lane

# the mixed workload
npm run sim -- bench scenarios/mixed-workload.yml --policies duration-based,adaptive-fast-lane --seeds 101,102,103

# one setting's effect over 5 seeds
npm run sim -- bench --policies adaptive-fast-lane --set ADAPTIVE_FAST_LANE_SYNC_FIRST=false --out output/no-sync-first
```

`bench` doesn't compare a run with `--set` against the policy's record, because the settings
differ. To measure one setting's effect, run the policy with and without it (both with `--out`)
and compare the runs seed by seed: each run's metrics are in
`<out>/runs/<policy>/<scenario>/seed-<n>/summary.json`, and `extractMetrics` in
`src/bench-metrics.ts` reads them the way `bench` does.
