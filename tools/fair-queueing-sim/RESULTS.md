# Fair queueing results: slot-based to adaptive-fast-lane

The improvement from Harmony's current fair queueing policy, `slot-based` (every production service
runs it), to the policy chosen to replace it, `adaptive-fast-lane` in its default configuration,
measured in the simulator. Recorded 2026-11-09 (HARMONY-2414). The reasoning behind the policy is in
[POLICY-DESIGN.md](POLICY-DESIGN.md); the scenarios are described for review in
[SCENARIOS.md](SCENARIOS.md).

- [What's being promoted](#whats-being-promoted)
- [Summary](#summary)
- [The results](#the-results)
- [Compared with the existing fast lane](#compared-with-the-existing-fast-lane)
- [Where the numbers come from](#where-the-numbers-come-from)
- [Reproducing them](#reproducing-them)

## What's being promoted

`adaptive-fast-lane` (`src/policies/adaptive-fast-lane.ts`) with its defaults:

| Setting | Value | |
|---|---|---|
| `ADAPTIVE_FAST_LANE_RESERVE_FRACTION` | `0.1` | the fast lane reserve: slow work (over `SLOW_WORK_THRESHOLD_MS`, 10 minutes) may never use more than 90% of a service's pods |
| `ADAPTIVE_FAST_LANE_EWMA_ALPHA` | `0` | fix 2 (moving average of durations) off |
| `ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION` | `false` | fix 5 (pod-reported durations) off |
| all other `ADAPTIVE_FAST_LANE_*` | their defaults | fixes 1, 3, 4, 6, 7 and 8 on (see [REFERENCE.md](REFERENCE.md#policy-settings)) |

With fixes 2 and 5 off it uses only the durations Harmony already keeps (`user_work.average_duration`),
so it needs no work-updater hook and no migration.

## Summary

**The problem it solves: one user with slow or long work items taking a service's resources.** It
happens in two ways, and `adaptive-fast-lane` prevents both:

- **While others are waiting.** `slot-based` gives every user a slice of each scheduling batch, so a
  user whose work items take minutes keeps accumulating pods while others' come back in seconds. On
  the hoss scenario (built from production's stats), one user with 8.5 minute work items held 6.5
  times its fair share of the pods: contended fairness 0.23, sync requests waiting up to 19 seconds
  (95th percentile). With `adaptive-fast-lane`: fairness 0.93, sync requests within 6 seconds. The
  dashboard's live view of production hoss showed the same takeover (103 of 151 running work items).
- **Before anyone else arrives.** On an idle 125 pod service, a user with 30-60 minute work items
  takes every pod under `slot-based`; work arriving afterwards waits for them to finish, since
  Harmony doesn't interrupt running work items. Sync requests waited 27 minutes (95th percentile)
  and no fast job finished within the 2 hours. With `adaptive-fast-lane`: sync requests within 8
  seconds, fast jobs about 7 times their minimum.

**Why not the existing fast lane?** Harmony already has one, `duration-based`, but production
doesn't use it - and in both of the cases above it does no better than `slot-based`: on hoss
fairness stays at 0.23, and when a slow user arrives first sync requests still wait about 27
minutes. Against it, `adaptive-fast-lane` is better in every seed on 16 of 21 production scenario
metrics and 17 of 24 story metrics. See [Compared with the existing fast lane](#compared-with-the-existing-fast-lane).

**Across the board** (5 seeds for each scenario except the mixed workload's 3; a difference counts
when it holds in every seed):

- **Production scenarios:** better in every seed on 16 of the 21 protected metrics; the only metric
  worse in every seed is utilization, by 0.3-1.0 points.
- **The 12 stories:** better in every seed on 16 of the 24 protected metrics; worse in every seed on
  5 - the expected costs below.
- **The mixed workload:** better in all 3 seeds on every headline metric - mean job slowdown -29%,
  sync latency -47%, fairness +10% - for utilization lower by less than 0.1 points.

**The costs:**

- **The reserve.** When slow work has a service to itself it can use only 90% of the pods: a slow
  job alone takes 16% longer (story 07). Production's stats suggest that's rare - about 0.4% of
  work items take over 5 minutes, under 0.1% over 15.
- **A slower start for a new job.** A new job runs 2 work items until its first one finishes, so
  nobody can fill a service before anyone knows their work is slow: about 1% on a big job alone
  (stories 01, 02, 10), and 0.3-1.0 points of utilization on the production scenarios.
- **It's production's first duration-aware scheduling** (its queries, its Postgres advisory lock, the
  reserve), which the simulator can't test - so a sandbox or UAT trial comes first, and the rollback
  is switching back to `slot-based`.

One thing no policy fixes: on geoloco, sync requests wait about 30 seconds under every policy,
because ~15 work items are already queued for the service ahead of them. That's how much work
Harmony queues ahead of time, not the fair queueing policy.

## The results

Each value is the mean over the seeds; **seeds** says in how many the new policy was better or worse
than `slot-based` with the same seed (the same work item durations and arrivals).

### Production scenarios (`scenarios/production/`, 125 pods, seeds 101-105)

**hoss-saturated** - hoss under a permanent backlog, 16 users, built from the dashboard's stats:

| | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 18.9s | 5.9s | -69% | **better in 5/5** |
| sync latency (mean) | 7.2s | 2.5s | -66% | **better in 5/5** |
| contended fairness | 0.23 | 0.93 | +311% | **better in 5/5** |
| long-items fair share | 6.45 | 1.14 | -82% | **better in 5/5** |
| one-at-a-time mean slowdown | 3.72 | 1.90 | -49% | **better in 5/5** |
| utilization | 97.8% | 96.8% | -1.0 points | **worse in 5/5** |

**trajectory-burst** - a trajectory-subsetter burst, 11 users with a heavy tail, from its stats:

| | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 22.1s | 9.8s | -56% | **better in 5/5** |
| contended fairness | 0.66 | 0.97 | +46% | **better in 5/5** |
| mid-2 mean slowdown | 7.13 | 5.72 | -20% | better in 4, worse in 1 |
| small-1 mean slowdown | 4.24 | 1.29 | -70% | **better in 5/5** |
| utilization | 99.2% | 98.5% | -0.6 points | **worse in 5/5** |

**geoloco-one-user** - one user keeps geoloco full, as in production; a newcomer arrives:

| | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| newcomer slowdown | 1.59 | 1.51 | -5% | **better in 5/5** |
| small mean slowdown | 1.13 | 1.09 | -4% | **better in 5/5** |
| sync latency (p95) | 33.8s | 31.8s | -6% | better in 3, worse in 2 |
| contended fairness | 0.93 | 0.95 | +2% | **better in 5/5** |
| utilization | 99.6% | 99.2% | -0.3 points | **worse in 5/5** |

**slow-user-first** - an idle service; a user with 30-60 minute work items arrives first, fast work
and sync requests 5 minutes later:

| | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 26m 57s | 7.8s | -99.5% | **better in 5/5** |
| sync latency (mean) | 6m 27s | 1.7s | -99.6% | **better in 5/5** |
| fast-jobs mean slowdown | none finished | 7.09 | - | **better** (none finished before) |
| slow fair share | 3.71 | 1.27 | -66% | **better in 5/5** |
| contended fairness | 0.24 | 0.81 | +237% | **better in 5/5** |

### The mixed workload (`scenarios/mixed-workload.yml`, seeds 101-103)

Six hours of random arrivals from five users on a two step chain; none of the fixes were tuned on
it:

| | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| mean job slowdown | 4.64 | 3.31 | -29% | **better in 3/3** |
| max job slowdown | 21.80 | 13.61 | -38% | **better in 3/3** |
| sync makespan (mean) | 1m 10s | 51.3s | -27% | **better in 3/3** |
| sync makespan (max) | 3m 15s | 1m 40s | -49% | **better in 3/3** |
| sync latency (mean) | 40.2s | 21.3s | -47% | **better in 3/3** |
| sync latency (p95) | 1m 28s | 43.8s | -50% | **better in 3/3** |
| contended fairness | 0.88 | 0.97 | +10% | **better in 3/3** |
| utilization | 70.8% | 70.8% | -0.0 points | **worse in 3/3** |

### The stories (`scenarios/stories/`, 20 pods, seeds 101-105)

Each story's protected metrics, from the benchmark records:

| story | | slot-based (production) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|---|
| 01-alone | utilization | 97.4% | 96.3% | -1.1 points | **worse in 5/5** |
| 01-alone | alice-big slowdown | 1.03 | 1.04 | +1% | **worse in 5/5** |
| 02-small-sync | bob-sync makespan | 1m 14s | 1m 25s | +14% | better in 2, worse in 3 |
| 02-small-sync | alice-big makespan | 1h 05m | 1h 05m | +1% | **worse in 5/5** |
| 03-sync-behind-own-async | bob-sync makespan | 1m 38s | 1m 09s | -30% | **better in 5/5** |
| 03-sync-behind-own-async | contended fairness | 0.98 | 0.99 | +1% | **better in 5/5** |
| 04-crowded | contended fairness | 0.86 | 0.92 | +7% | **better in 5/5** |
| 04-crowded | bob-sync makespan | 1m 51s | 1m 28s | -21% | better in 3, worse in 2 |
| 05-newcomer | erin-1 slowdown | 9.83 | 6.36 | -35% | **better in 5/5** |
| 05-newcomer | max job slowdown | 9.83 | 6.46 | -34% | **better in 5/5** |
| 06-slow-vs-fast | gina-fast slowdown | 7.56 | 3.28 | -57% | **better in 5/5** |
| 06-slow-vs-fast | hank-fast slowdown | 7.38 | 3.35 | -55% | **better in 5/5** |
| 07-slow-alone | frank-slow makespan | 2h 51m | 3h 19m | +16% | **worse in 5/5** |
| 08-many-jobs | judy fair share | 0.40 | 0.96 | +139% | **better in 5/5** |
| 08-many-jobs | contended fairness | 0.74 | 0.98 | +31% | **better in 5/5** |
| 09-slowdown-drift | lee mean slowdown | 21.75 | 3.72 | -83% | **better in 5/5** |
| 09-slowdown-drift | lee max slowdown | 43.24 | 8.41 | -81% | **better in 5/5** |
| 10-multi-granule-sync | bob-sync makespan | 1m 47s | 1m 39s | -8% | better in 1, worse in 4 |
| 10-multi-granule-sync | alice-big makespan | 1h 05m | 1h 05m | +1% | **worse in 5/5** |
| 11-new-slow-pair | gina-fast slowdown | 12.47 | 2.41 | -81% | **better in 5/5** |
| 11-new-slow-pair | contended fairness | 0.72 | 0.98 | +35% | **better in 5/5** |
| 12-occasional-long-items | nora-mixed slowdown | 3.66 | 2.75 | -25% | **better in 5/5** |
| 12-occasional-long-items | nora fair share | 0.74 | 0.90 | +21% | **better in 5/5** |
| 12-occasional-long-items | omar-fast slowdown | 9.69 | 3.19 | -67% | **better in 5/5** |

## Compared with the existing fast lane

Harmony already has a fast lane: `duration-based` (HARMONY-2413, `durationBasedPolicy` in
`fair-queueing-policy.ts`), which ranks users by the expected runtime of their work and keeps 30% of
each service's pods away from slow work. It runs when `ENABLE_DURATION_BASED_FAIR_QUEUEING` is true,
which it isn't in production. `adaptive-fast-lane` is built on it: with its fixes off and the same
30% reserve it makes exactly the same decisions, which `findings` checks in every story. So the
differences below are what the fixes and the smaller reserve add - and why the choice is
`adaptive-fast-lane` rather than switching the existing fast lane on.

**Against `duration-based`** (the same runs and records as above):

- **Production scenarios:** better in every seed on 16 of the 21 protected metrics; worse in every
  seed only on utilization, by 0.3-1.0 points.
- **The 12 stories:** better in every seed on 17 of the 24; worse in every seed on 4, all a new
  job's slower start (01, 02, 10 - about 1% on a big job alone).
- **The mixed workload:** better in all 3 seeds on every headline metric (mean job slowdown -29%,
  sync latency -50%).

**Why the existing fast lane isn't enough.** It protects fast work only from work it has already
measured as slow (a mean over 10 minutes), and only by capping slow work at 70% of the pods. In
production's terms, that leaves the problems this work set out to fix:

- **A user whose work items are long but not "slow" can still take a service.** Like `slot-based`,
  it hands every user a slice of each batch, so a user with 8.5 minute work items - under the 10
  minute threshold, so the cap doesn't apply - accumulates pods. On hoss it does no better than
  `slot-based`: contended fairness 0.23, sync latency 20 seconds (95th percentile). `adaptive-fast-lane`
  holds every user to their fair share while others wait (fix 6): fairness 0.93, sync latency 6
  seconds.
- **A slow user who reaches an idle service first takes all of it.** Until a work item finishes, the
  fast lane doesn't know the work is slow, so on an idle service it hands out every pod: in
  slow-user-first, sync requests wait 27 minutes (95th percentile), as with `slot-based`.
  `adaptive-fast-lane` runs only 2 work items of a new job (plus a shared allowance) until one
  finishes, and treats work running longer than the threshold as slow without waiting for it to
  finish (fixes 1 and 7): sync requests within 8 seconds.
- **A user with many jobs gets more than a user with one.** It splits each batch evenly per job: in
  story 08 Judy, with one job against another user's four, gets 0.40 of a fair share.
  `adaptive-fast-lane` splits the batch between users first (fix 4): 0.96.
- **A job that turns slow isn't noticed.** It classifies a job by the mean over its whole lifetime,
  so 200 slow work items after 1,000 fast ones never register (story 09: Lee's jobs take 21.8 times
  their minimum). `adaptive-fast-lane` doesn't need to notice: fair share holds the user back
  anyway (3.7 times their minimum).
- **Sync requests wait behind their own user's work.** `adaptive-fast-lane` gives sync requests each
  batch first and never holds them back (fix 8): story 03's sync request -26%.
- **The reserve costs more than it needs to.** At production's scale fix 1 does much of the
  protecting, so `adaptive-fast-lane`'s 10% reserve still meets the 10 second sync target, and a slow
  job alone finishes 12% sooner than under the fast lane's 30% (story 07).

And it costs no more to adopt: `duration-based` has never run in production either, so enabling it
would be just as much production's first duration-aware scheduling. With fixes 2 and 5 off,
`adaptive-fast-lane` uses the same durations Harmony already keeps, so it needs nothing the fast lane
doesn't.

### Production scenarios, against duration-based

**hoss-saturated:**

| | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 20.3s | 5.9s | -71% | **better in 5/5** |
| sync latency (mean) | 7.4s | 2.5s | -67% | **better in 5/5** |
| contended fairness | 0.23 | 0.93 | +311% | **better in 5/5** |
| long-items fair share | 6.44 | 1.14 | -82% | **better in 5/5** |
| one-at-a-time mean slowdown | 3.78 | 1.90 | -50% | **better in 5/5** |
| utilization | 97.8% | 96.8% | -1.0 points | **worse in 5/5** |

**trajectory-burst:**

| | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 25.6s | 9.8s | -62% | **better in 5/5** |
| contended fairness | 0.66 | 0.97 | +47% | **better in 5/5** |
| mid-2 mean slowdown | 7.12 | 5.72 | -20% | better in 4, worse in 1 |
| small-1 mean slowdown | 4.18 | 1.29 | -69% | **better in 5/5** |
| utilization | 99.2% | 98.5% | -0.6 points | **worse in 5/5** |

**geoloco-one-user:**

| | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| newcomer slowdown | 1.58 | 1.51 | -4% | **better in 5/5** |
| small mean slowdown | 1.13 | 1.09 | -4% | **better in 5/5** |
| sync latency (p95) | 34.7s | 31.8s | -8% | better in 3, worse in 2 |
| contended fairness | 0.94 | 0.95 | +1% | **better in 5/5** |
| utilization | 99.6% | 99.2% | -0.3 points | **worse in 5/5** |

**slow-user-first:**

| | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| sync latency (p95) | 26m 40s | 7.8s | -99.5% | **better in 5/5** |
| sync latency (mean) | 5m 22s | 1.7s | -99% | **better in 5/5** |
| fast-jobs mean slowdown | 24.22 | 7.09 | -71% | **better in 5/5** |
| slow fair share | 2.18 | 1.27 | -42% | **better in 5/5** |
| contended fairness | 0.55 | 0.81 | +47% | **better in 5/5** |

### The mixed workload, against duration-based

| | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|
| mean job slowdown | 4.69 | 3.31 | -29% | **better in 3/3** |
| max job slowdown | 21.10 | 13.61 | -35% | **better in 3/3** |
| sync makespan (mean) | 1m 13s | 51.3s | -30% | **better in 3/3** |
| sync makespan (max) | 3m 16s | 1m 40s | -49% | **better in 3/3** |
| sync latency (mean) | 42.8s | 21.3s | -50% | **better in 3/3** |
| sync latency (p95) | 1m 47s | 43.8s | -59% | **better in 3/3** |
| contended fairness | 0.88 | 0.97 | +10% | **better in 3/3** |
| utilization | 70.8% | 70.8% | -0.0 points | **worse in 3/3** |

### The stories, against duration-based

| story | | duration-based (fast lane) | adaptive-fast-lane | change | seeds |
|---|---|---|---|---|---|
| 01-alone | utilization | 97.4% | 96.3% | -1.1 points | **worse in 5/5** |
| 01-alone | alice-big slowdown | 1.03 | 1.04 | +1% | **worse in 5/5** |
| 02-small-sync | bob-sync makespan | 1m 14s | 1m 25s | +14% | better in 2, worse in 3 |
| 02-small-sync | alice-big makespan | 1h 05m | 1h 05m | +1% | **worse in 5/5** |
| 03-sync-behind-own-async | bob-sync makespan | 1m 33s | 1m 09s | -26% | **better in 5/5** |
| 03-sync-behind-own-async | contended fairness | 0.98 | 0.99 | +1% | **better in 5/5** |
| 04-crowded | contended fairness | 0.82 | 0.92 | +12% | **better in 5/5** |
| 04-crowded | bob-sync makespan | 1m 38s | 1m 28s | -10% | better in 3, worse in 2 |
| 05-newcomer | erin-1 slowdown | 10.21 | 6.36 | -38% | **better in 5/5** |
| 05-newcomer | max job slowdown | 10.21 | 6.46 | -37% | **better in 5/5** |
| 06-slow-vs-fast | gina-fast slowdown | 7.36 | 3.28 | -55% | **better in 5/5** |
| 06-slow-vs-fast | hank-fast slowdown | 7.16 | 3.35 | -53% | **better in 5/5** |
| 07-slow-alone | frank-slow makespan | 3h 46m | 3h 19m | -12% | **better in 5/5** |
| 08-many-jobs | judy fair share | 0.40 | 0.96 | +139% | **better in 5/5** |
| 08-many-jobs | contended fairness | 0.74 | 0.98 | +31% | **better in 5/5** |
| 09-slowdown-drift | lee mean slowdown | 21.84 | 3.72 | -83% | **better in 5/5** |
| 09-slowdown-drift | lee max slowdown | 43.23 | 8.41 | -81% | **better in 5/5** |
| 10-multi-granule-sync | bob-sync makespan | 1m 50s | 1m 39s | -10% | better in 4, worse in 1 |
| 10-multi-granule-sync | alice-big makespan | 1h 05m | 1h 05m | +1% | **worse in 5/5** |
| 11-new-slow-pair | gina-fast slowdown | 4.78 | 2.41 | -50% | **better in 5/5** |
| 11-new-slow-pair | contended fairness | 0.89 | 0.98 | +9% | **better in 5/5** |
| 12-occasional-long-items | nora-mixed slowdown | 3.67 | 2.75 | -25% | **better in 5/5** |
| 12-occasional-long-items | nora fair share | 0.80 | 0.90 | +13% | **better in 5/5** |
| 12-occasional-long-items | omar-fast slowdown | 9.67 | 3.19 | -67% | **better in 5/5** |

## Where the numbers come from

- **The stories** come from the committed benchmark records, `benchmarks/results/slot-based.json`,
  `benchmarks/results/duration-based.json` and
  `benchmarks/results/adaptive-fast-lane.json` (duration-based: 553308212 + uncommitted changes, code hash 4012a8431651c8cc, Node v24.21.0, linux-arm64, 2026-11-09; slot-based: 553308212 + uncommitted changes, code hash 4012a8431651c8cc, Node v24.21.0, linux-arm64, 2026-11-09; adaptive-fast-lane: 553308212 + uncommitted changes, code hash 4629080262a3e085, Node v24.21.0, linux-arm64, 2026-11-09). Each record holds every metric for
  every story and seed, with the settings and a hash of the code that produced it.
- **The production scenarios and the mixed workload** aren't in the records; their numbers are from
  `bench` runs on 2026-11-09 of the same code, with the commands below.
- **Determinism:** runs are deterministic, and `findings` checks that `adaptive-fast-lane` with its
  fixes off (and the work-scheduler's 30% reserve) makes exactly the same decisions as
  `duration-based`, so every difference above comes from the fixes and the reserve.
- **Limits:** the simulator runs Harmony's real scheduling and work item update code, but on sqlite,
  one event at a time, with fixed pod counts and no query-cmr step, aggregation or cancellation;
  see [REFERENCE.md](REFERENCE.md#limitations). The production scenarios' header comments say which
  parts come from production's stats and which are assumed.

## Reproducing them

From `tools/fair-queueing-sim` (see the [README](README.md#setup) for setup):

```
# the stories: compares each policy with slot-based's record and with its own
npm run sim -- bench

# the production scenarios (slot-based is run alongside, since they aren't in the records)
npm run sim -- bench scenarios/production/hoss-saturated.yml scenarios/production/trajectory-burst.yml scenarios/production/geoloco-one-user.yml scenarios/production/slow-user-first.yml

# the mixed workload
npm run sim -- bench scenarios/mixed-workload.yml --seeds 101,102,103
```

Each writes `bench.md`, with the same tables and every other metric, to `output/bench/` (or
`--out`); its **vs duration-based** columns are the comparison with the existing fast lane.

**Simulating the baseline on its own**, e.g. to look at a run in detail:

```
npm run sim -- run scenarios/production/slow-user-first.yml --policy slot-based --seed 101
npm run sim -- compare scenarios/production/slow-user-first.yml --policies slot-based,adaptive-fast-lane
```

`slot-based` is Harmony's own `slotBasedPolicy` (`fair-queueing-policy.ts`), not a copy, so it can
be simulated for as long as Harmony keeps it - which the promotion keeps, as the rollback (README,
[step 6](README.md#6-promote-it-to-production)). If it's ever removed, check out a commit that has
it and run the commands there, or compare against one with `findings --references
<commit>=slot-based` (REFERENCE.md, [Writing up findings](REFERENCE.md#writing-up-findings)).

**The policy as it was configured before these defaults** (a 30% reserve, fixes 2 and 5 on):

```
npm run sim -- bench --policies adaptive-fast-lane --set ADAPTIVE_FAST_LANE_RESERVE_FRACTION=scheduler --set ADAPTIVE_FAST_LANE_EWMA_ALPHA=0.2 --set ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION=true
```

A run's results only match the ones above if the code that affects results is the same; `bench`
says when it isn't (the code hashes above), and `npm run sim -- bench --record` saves new records.
