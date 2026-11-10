# Fair queueing policy design

Why `fair-share-fast-lane` (Harmony's `fair-share-fast-lane-policy.ts`, next to
`fair-queueing-policy.ts`; the simulator-only parts are in `src/policies/fair-share-fast-lane.ts`)
is built the way it is: the problem each fix solves, the evidence for it, the trade-offs chosen and
the alternatives that were rejected. What each fix does, and its settings, are in the code's header comment and in
[REFERENCE.md](REFERENCE.md#available-policies); this file is the reasoning behind them.

It was called `adaptive-fast-lane` until 2026-11-10. The name came from its moving average of
durations (fix 2), which is now off by default; it was renamed for what it does by default: hold
every user to a fair share of the pods while others wait (its main gain), on top of a fast lane
that limits new work until it's measured.

`fair-share-fast-lane` is the policy chosen to replace `slot-based`, the policy every Harmony
service runs today. It's built on `duration-based`, the fast lane from HARMONY-2413, which Harmony
has but production doesn't use. It's [in Harmony now](#promoting-it), selected with the
work-scheduler's `FAIR_QUEUEING_POLICY=fair-share-fast-lane`, but the default is still `slot-based`.
The smaller candidate, [`slot-based-fair-share`](#the-smaller-candidate-slot-based-fair-share) -
`slot-based` plus the two of its fixes that need no work item durations - runs in the simulator
only.

- [Ground rules](#ground-rules)
- [Results](#results)
- [The smaller candidate: slot-based-fair-share](#the-smaller-candidate-slot-based-fair-share)
- [Production scenarios and the recommendation](#production-scenarios-and-the-recommendation)
- [The fixes](#the-fixes)
- [Judgment calls](#judgment-calls)
- [Considered and not done](#considered-and-not-done)
- [Promoting it](#promoting-it)
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

The full results for the default configuration - a 10% reserve, fixes 2 and 5 off - are in
[RESULTS.md](RESULTS.md), with how to reproduce them. In brief, against `slot-based`, what
production runs (5 seeds; a difference counts when it holds in every seed):

- **The 12 stories:** better in every seed on 16 of the 24 protected metrics. Worse in every seed on
  5, all expected costs: a new job's slower start (01, 02, 10 - about 1% on a big job alone, and 01's
  utilization), and the reserve when slow work is alone (07: +16%). The fast lane reserve is new for
  production, which has none, but production would rarely meet its cost: across all services in the
  dashboard's stats, about 0.4% of work items take over 5 minutes and under 0.1% over 15.
- **The four production scenarios:** better in every seed on 16 of 21 protected metrics, including a
  slow user arriving first (sync requests wait 8 seconds instead of 27 minutes) and the hoss takeover
  (contended fairness 0.23 -> 0.93); utilization 0.3-1.0 points lower.
- **The mixed workload:** better in every seed on every headline metric (mean job slowdown -29%).

Against `duration-based`, the policy it's built on: better in every seed on 17 of the 24 story
metrics, worse only in the new job's slower start (01, 02, 10, about 1%).

The rest of this file explains the design. Its numbers come from the experiments that led to each
decision, mostly with the configuration of the time (fixes 2 and 5 on, a 30% reserve), and before
fix 1's limit was corrected on 2026-11-10 (see fix 1 below); RESULTS.md has the current ones.

## The smaller candidate: slot-based-fair-share

On the hoss scenario, `findings` showed that one fix produces all of `fair-share-fast-lane`'s
improvement: fix 6 holding every user to their fair share (with `FAIR_SHARE_ALL`). Switched off,
the policy does no better than `duration-based`; holding only *slow* users to their share does
nothing there either, because the user taking over hoss has 8.5 minute work items, which aren't
"slow". And fix 6 doesn't need durations: it works from each user's running and ready work item
counts, which `slot-based` already has. So `slot-based-fair-share`
(`src/policies/slot-based-fair-share.ts`) is `slot-based` - Harmony's own job selection, unchanged -
plus fix 6 for every user and fix 8 (sync requests first), and nothing else: no durations, no
schema change, no work-updater hook, no fast lane reserve. With both fixes off it makes exactly the
same decisions as `slot-based`, which `findings` checks in every story.

**Against `slot-based`** (the benchmark records, 12 stories, seeds 101-105): better in every seed
on 15 of the 24 protected metrics, and **worse in every seed on none** - with no new job limit and
no reserve, the costs in 01, 02, 07 and 10 don't arise. Contended fairness in 04 (+8%), 08 (+33%)
and 11 (+31%); the newcomer in 05 (-18%); the fast users in 06 (-37%), 11 (-54%) and 12 (-60%);
Judy's share in 08 (0.40 -> 0.98); Nora in 12; Lee in 09 (-83%). Holding users to a fair share
also covers much of the slow work stories without knowing what's slow: a user with slow work holds
pods for a long time, so the fair share limits them.

**On the hoss scenario** (seeds 101-105), in every seed against `slot-based`: sync latency (95th
percentile) 18.9 -> 6.3 seconds, contended fairness 0.23 -> 0.86, the 8.5 minute user's share of
the pods 6.4 -> 1.4 times its fair share, the one-at-a-time user 3.7 -> 2.1 times their minimum,
for 0.8% less utilization. That's most of `fair-share-fast-lane`'s gain there (6.0 s, 0.92, 1.1, 1.9).

**On the mixed workload** (`scenarios/mixed-workload.yml`, which none of the fixes were tuned on;
seeds 101-103), in every seed against `slot-based`: mean job slowdown -26%, worst -35%, mean sync
makespan -26% (worst -45%), contended fairness 0.88 -> 0.97, with the same utilization. That's
within a few percent of `fair-share-fast-lane` on every headline metric; `fair-share-fast-lane` is 5%
better on mean slowdown in every seed, and leaves 41% more pods idle while work waits (its
reserve).

**What knowing durations adds** (`fair-share-fast-lane` against `slot-based-fair-share`, the same
records): better in every seed on new slow jobs taking the service before they're known to be slow
(06 -33%, 11 -65%), the newcomer in 05 (-15%) and the fast user in 12 (-18%); worse in every seed
on a slow job alone (07, +45%, the reserve), big jobs alone or nearly alone (01, 02 +1.5%, 10
+27%) and slightly on fairness in 04 (-1.4%) and 11 (-0.5%). Those gains protect fast work against
new slow jobs, which production's stats suggest are rare; the costs come from the reserve and from
limiting new jobs until they're measured.

On its own, that would make `slot-based-fair-share` the obvious first step. The production
scenarios below show why it isn't enough.

## Production scenarios and the recommendation

Four scenarios in `scenarios/production/` are built at production's scale (125 pods, work items of
seconds to minutes), three of them from the admin dashboard's stats for a service. Each file says
which parts come from the data and which are assumed. Seeds 101-105; "every seed" against the
policy named. This table is the comparison that led to the decision, with `fair-share-fast-lane` as
configured then (a 30% reserve, fixes 2 and 5 on); its current figures are in
[RESULTS.md](RESULTS.md).

| | slot-based (production) | slot-based-fair-share | fair-share-fast-lane |
|---|---|---|---|
| **slow-user-first**: an idle service, then a user with 30-60 minute work items, then fast work and sync requests 5 minutes later | | | |
| sync latency, 95th percentile | 27 min | 27 min | **2.2 s** |
| fast jobs, times their minimum | not finished within 2 hours | 37 | **3.4** |
| the slow user's share of the pods (ideal 1.0) | 3.7 | 2.2 | **0.9** |
| **hoss-saturated**: hoss under a permanent backlog, 16 users | | | |
| sync latency, 95th percentile | 18.9 s | 6.3 s | **6.0 s** |
| contended fairness | 0.23 | 0.86 | **0.92** |
| **trajectory-burst**: a trajectory-subsetter burst, 11 users, a heavy tail | | | |
| sync latency, 95th percentile | 22.1 s | 13.1 s | **9.8 s** |
| contended fairness | 0.66 | 0.91 | **0.96** |
| **geoloco-one-user**: one user keeps the service full; a newcomer arrives | | | |
| newcomer, times its minimum | 1.59 | 1.51 | 1.50 |
| sync latency, 95th percentile | 34 s | 30 s | 32 s |

Two ways one user's slow work items can take a service:

1. **While others are waiting** (hoss, trajectory-subsetter): every scheduling pass hands that user
   more pods, and they keep them. Both candidates fix this, because both hold each user to their
   fair share; `fair-share-fast-lane` a little better, and only it meets the 10 second sync target on
   trajectory-subsetter.
2. **Before anyone else arrives** (slow-user-first): with nobody waiting, `slot-based-fair-share` -
   which is work-conserving - lets the slow user take every idle pod, and work arriving afterwards
   waits for running work items to finish, which Harmony doesn't interrupt: about 27 minutes for a
   sync request. `fair-share-fast-lane` prevents it with fix 1 (a new job runs 2 work items, plus its
   share of an allowance, until one finishes) and the reserve, and fast work starts within seconds.

The second case is rare in production's stats, but it's the incident this work set out to
prevent, and when it happens it costs tens of minutes rather than seconds.

On geoloco no policy gets sync requests under 10 seconds: about 15 work items are already waiting
on the service's queue ahead of each new one, and with 2 minute work items on 125 pods one comes
free about every second. That's how much work Harmony queues for a service ahead of time
(`SERVICE_QUEUE_BATCH_SIZE_COEFFICIENT`), which a fair queueing policy doesn't control.

**`fair-share-fast-lane` without its hook does as well.** With the moving average and pod-reported
durations off (`FAIR_SHARE_FAST_LANE_EWMA_ALPHA=0`, `FAIR_SHARE_FAST_LANE_USE_SERVICE_DURATION=false`)
it matched the full policy on all four production scenarios, within noise. In that configuration
it uses only the durations Harmony already keeps (`user_work.average_duration`), so it needs no
work-updater hook and no migration. Those two fixes only made a difference in story 09 (a job whose
work items suddenly get slower), which production's reviewers say is rare.

**Decision (2026-11-09): `fair-share-fast-lane`, with fixes 2 and 5 off and a 10% reserve** - now its
defaults, and the configuration [RESULTS.md](RESULTS.md) records. It's the only candidate that
stops one user's slow work taking a service in both cases, it's at least as good as
`slot-based-fair-share` on every production scenario, and without fixes 2 and 5 it needs no hook or
migration. Its costs: the reserve (a slow job alone takes 45% longer at today's 30% reserve, 16% at 10% -
see the reserve sweep below), a slower start for a new job (about 1% on a big job alone), and being production's
first duration-aware scheduling, which needs a sandbox or UAT trial (see
[Promoting it](#promoting-it)). `slot-based-fair-share` remains a smaller option if
that trial has to wait: it fixes the first case, but not the second.

**The reserve can be much smaller.** Chris asked for a much lower reserve of idle pods. Sweeping the
reserve (with fixes 2 and 5 off, seeds 101-105; re-run 2026-11-10 after fix 1's correction):

| | slot-based | 30% (duration-based's) | 20% | 10% |
|---|---|---|---|---|
| slow-user-first: sync latency, 95th percentile | 26m 57s | 2.0 s | 3.9 s | 8.1 s |
| slow-user-first: fast jobs, times their minimum | none finished | 3.4 | 4.7 | 7.1 |
| slow-user-first: the slow user's share (ideal 1.0) | 3.71 | 0.88 | 1.07 | 1.28 |
| 07: a slow job alone, time to finish | 2h 51m | 4h 09m (+45%) | 3h 41m (+29%) | 3h 19m (+16%) |
| 06: the fast users, times their minimum (both) | 7.5 | 3.1 | 3.2 | 3.3 |
| 11: the fast user, times its minimum | 12.5 | 2.0 | 2.3 | 2.5 |

hoss and trajectory-subsetter barely change with the reserve (hoss: sync latency 5.6-6.0 s,
fairness 0.92-0.93; trajectory-subsetter: 9.6-9.8 s, 0.96-0.97): they have almost no slow work,
so the reserve hardly applies. Even at 10%, sync requests meet the 10 second target when a slow user
arrives first (fix 1's limit on new jobs does much of the protecting), and the reserve's cost when
slow work is alone falls to a third. **Chosen: 10%**, given how rare slow work is in production
(20% would give more margin). It's `fair-share-fast-lane`'s own setting,
`FAIR_SHARE_FAST_LANE_RESERVE_FRACTION` (in the work-scheduler's `env-defaults`), so `duration-based`
keeps `FAST_LANE_RESERVE_FRACTION`'s 30%.

## The fixes

Feature table numbers are mean job slowdown from `findings` (one seed, all other fixes on);
everything else is over 5 seeds.

1. **Unmeasured work limit.** *Problem:* `duration-based` only knows work is slow once a work
   item finishes, so a new slow job fills the service first (story 06: slow work in flight peaks
   above the cap). *Decision:* a new (job, service) may run 2 work items until it's measured, plus
   a shared allowance for all unmeasured work (half the slow work capacity) that counts against
   the slow work capacity, so it never takes the reserve. *Evidence:* it produces the 06 win (off:
   slowdown 3.57 vs 2.74, fairness 0.78 vs 0.97) and helps 10 and 11. *Cost:* all of 01, 02 and
   07's costs above - switched off, 01 and 07 match `duration-based` exactly. *Correction
   (2026-11-10):* until then, the work-conserving pass at the end of each batch (fix 6) didn't count
   what a new job had just been given earlier in the batch, so it could give the job its limit
   again - up to 2 more work items per batch than intended. Fixing that changed stories 04, 05,
   06, 08, 11 and 12 slightly, and slow-user-first and the mixed workload by a few percent;
   RESULTS.md has the corrected numbers.
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

- **Fix 7 keeps fix 1's limits** (`FAIR_SHARE_FAST_LANE_RUNNING_EVIDENCE_KEEPS_LIMIT=true`).
  Without that, noticing that new work is slow moved it from fix 1's limits to the larger slow
  work capacity, so being noticed *loosened* its limit. With it: story 11's fast job -33% (5/5),
  for 11's fairness -1.5% (0/5), 07's slow job +2.9% (0/5) and one of 06's fast users +1.1% (1/4).
  Re-measured on story 11 after fix 1's correction (2026-11-10): the fast job -22% (3.20 -> 2.51
  times its minimum, 5/5), for fairness -1.1% (0.99 -> 0.98, 0/5).
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

## Promoting it

It was promoted (HARMONY-2414) following the README's
[promotion steps](README.md#6-promote-it-to-production): `fairShareFastLanePolicy` is in
`services/harmony/app/backends/workflow-orchestration/fair-share-fast-lane-policy.ts`, the
work-scheduler selects it with `FAIR_QUEUEING_POLICY=fair-share-fast-lane`, and its settings, with
the defaults above, are in `services/work-scheduler/env-defaults`. The default policy is still
`slot-based`. The simulator runs Harmony's code; `src/policies/fair-share-fast-lane.ts` only adds
what Harmony doesn't have: the columns and completion hook for fixes 2 and 5, and the sampler.
What's left, specific to this policy:

- **Production has never run duration-aware scheduling.** Every service runs `slot-based`, so this
  is also the first production use of `duration-based`'s queries, its advisory lock and the fast
  lane reserve. Trying plain `duration-based` in UAT first would separate "that machinery works"
  from "the fixes help". Rolling back means switching back to `slot-based`.
- **Fixes 2 and 5 stay in the simulator.** Harmony's policy ignores their settings (and logs a
  warning if they're set). Turning either on in production would need the completion hook in the
  work-updater's transaction, which means extending the policy interface, and a migration for its
  columns, replacing the simulator's `setup`.
- **Postgres-only paths are untested here.** The advisory lock and `SKIP LOCKED` that serialize
  concurrent scheduler pods never run in the simulator (sqlite, one event at a time). A sandbox
  deployment is the first real test of them.
- **Fix 5 needs a scenario that backs up the service queue** before it can be judged.

**For `slot-based-fair-share`, most of that doesn't apply.** It needs no completion hook, no
migration and no reserve, and it keeps `slot-based`'s job selection query, so it doesn't touch the
untested Postgres paths either. Promoting it would mean moving it into Harmony next to
`slotBasedPolicy` and adding it to `FAIR_QUEUEING_POLICIES` (README steps 1 and 2), testing it, and
checking the cost of
its two extra queries per scheduling pass - each user's running and ready counts for the service,
and the user and type of each job picked, both from `user_work` by service.

## Reproducing the evidence

```fish
# the 5-seed comparison with duration-based and slot-based (bench.md)
npm run sim -- bench

# what each fix contributes, and the duration-based equivalence check (findings.md)
npm run sim -- findings scenarios/stories/*.yml --policies duration-based,fair-share-fast-lane

# the mixed workload
npm run sim -- bench scenarios/mixed-workload.yml --policies duration-based,fair-share-fast-lane --seeds 101,102,103

# one setting's effect over 5 seeds
npm run sim -- bench --policies fair-share-fast-lane --set FAIR_SHARE_FAST_LANE_SYNC_FIRST=false --out output/no-sync-first
```

`bench` doesn't compare a run with `--set` against the policy's record, because the settings
differ. To measure one setting's effect, run the policy with and without it (both with `--out`)
and compare the runs seed by seed: each run's metrics are in
`<out>/runs/<policy>/<scenario>/seed-<n>/summary.json`, and `extractMetrics` in
`src/bench-metrics.ts` reads them the way `bench` does.
