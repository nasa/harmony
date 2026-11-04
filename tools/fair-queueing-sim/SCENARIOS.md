# Fair queueing scenarios, for review

The simulator judges fair queueing policies on the scenarios below, so they define what "better"
means: every policy change in this directory, including `adaptive-fast-lane`'s fixes, was tuned
and judged against them. Before a policy goes into Harmony, the scenarios themselves deserve a
review by people who know Harmony's real workloads. This file sets each one out in plain terms,
with how the policies currently do, and asks the questions where feedback would change something.

The scenario files (`scenarios/stories/*.yml`, `scenarios/mixed-workload.yml`) are the source of
truth; this file describes them as of 2026-11-04. The results come from the committed benchmark
records (`benchmarks/results/*.json`) - `npm run sim -- bench` regenerates them.

- [Questions for reviewers](#questions-for-reviewers)
- [How to read this](#how-to-read-this)
- The stories: [01](#01-alone) · [02](#02-small-sync) · [03](#03-sync-behind-own-async) ·
  [04](#04-crowded) · [05](#05-newcomer) · [06](#06-slow-vs-fast) · [07](#07-slow-alone) ·
  [08](#08-many-jobs) · [09](#09-slowdown-drift) · [10](#10-multi-granule-sync) ·
  [11](#11-new-slow-pair) · [12](#12-occasional-long-items)
- [The mixed workload](#the-mixed-workload)
- [What the scenarios don't cover](#what-the-scenarios-dont-cover)

## Questions for reviewers

Each story ends with questions specific to it. Across all of them:

1. **Are they realistic?** Every story uses one service of 20 pods, work items of 30 seconds to 30
   minutes, and jobs of 50 to 1,200 granules. Are those shapes like Harmony's real services and
   users? Which real situations do they miss?
2. **Is each "good outcome" what Harmony wants?** These are the judgment calls. The ones that most
   affect policy choices are 05 (even sharing vs. low average slowdown), 07 (what the fast lane
   reserve may cost), 10 (whether multi-granule sync requests matter) and 11 (fast work first vs.
   fair from the start - `adaptive-fast-lane`'s fix 7 default rests on this one).
3. **Are the costs acceptable?** `adaptive-fast-lane` is worse than `duration-based` in every
   seed in three places: a big job alone or nearly alone takes about a minute (2%) longer (01, 02,
   10), and a slow job alone about 10% longer (07). See [POLICY-DESIGN.md](POLICY-DESIGN.md#results).
4. **What's missing?** See [What the scenarios don't cover](#what-the-scenarios-dont-cover).

Comment on the pull request, or edit this file with your answers.

## How to read this

**The setup every story shares.** One service with 20 pods; one work-scheduler pod and one
work-updater pod; Harmony's default fast lane settings (work is "slow" above 10 minutes, and slow
work may use at most 70% of the pods, leaving a 30% reserve for fast work); and
`QUEUE_LONG_POLLING_WAIT_TIME_SEC=3`, Harmony's default. A job has one work item per granule. Work
item durations are random: "about 2 minutes" means a lognormal distribution with a median of
2 minutes, where most work items take between roughly 1 and 3.5 minutes. Sync requests are 1
granule, the production limit (`MAX_SYNCHRONOUS_GRANULES=1`), except in story 10.

**The metrics** (defined fully in [REFERENCE.md](REFERENCE.md#the-metrics)):

- **makespan** - from a job's submission to its completion.
- **slowdown** - makespan divided by how long the job would take with the service to itself:
  1.0 is as fast as possible, 2.0 twice as long.
- **fair share** - while a user competes with others: the pods running their work divided by their
  fair share of the pods (an equal split, except that users who want fewer get what they want).
  1.00 is exactly fair.
- **contended fairness** - how evenly the competing users got their shares (1.0 = exactly even).
- **utilization** - the share of pod time spent running work.

**Protected metrics** are the ones each story names as expressing its goal; its results table
shows those. Values are means over 5 seeds (101-105). Runs with the same seed have the same work
item durations under every policy, so "better in 5/5 seeds" is a real difference and a mixed
count is noise.

**The policies:** `slot-based` is Harmony's default; `duration-based` is Harmony's alternative,
used when `ENABLE_DURATION_BASED_FAIR_QUEUEING` is true; `adaptive-fast-lane` is the candidate
replacement for `duration-based` (see [POLICY-DESIGN.md](POLICY-DESIGN.md)).

## The stories

### 01-alone

**What it models:** one user with the service to themselves - the baseline that no policy should
make worse.

**Setup:** Alice has one async job of 600 granules, about 2 minutes each.

**Good outcome:** Alice uses every pod: utilization close to 100%, slowdown close to 1.0. All
policies should do equally well.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| utilization | 97.4% | 97.4% | 95.9% | -1%, **worse in 5/5 seeds** |
| alice-big slowdown | 1.03 | 1.03 | 1.04 | +2%, **worse in 5/5 seeds** |

`adaptive-fast-lane` runs a new job 2 work items at a time until the first one finishes, so it
can't fill the service before anyone knows whether its work is slow. Here that costs about a
minute on a 1 hour job.

**For reviewers:** is a minute at the start of a new job an acceptable price for protecting the
service from unknown slow jobs?

### 02-small-sync

**What it models:** an interactive user waiting behind someone else's big batch job.

**Setup:** Alice's async job (600 granules, about 2 minutes each) fills the service. Ten minutes in,
Bob sends a 1 granule sync request that takes 1 minute.

**Good outcome:** Bob's request finishes close to its 1 minute minimum, without noticeably delaying
Alice.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| bob-sync makespan | 1m 14s | 1m 14s | 1m 12s | -3%, better in 3, worse in 2 of 5 |
| alice-big makespan | 1h 05m | 1h 05m | 1h 06m | +2%, **worse in 5/5 seeds** |

Bob's request has to wait for one of Alice's work items to finish, since no policy preempts
running work, so it can't finish in exactly its 1 minute.

**For reviewers:** is "close to the minimum" the right goal for sync requests, or is there a
target latency that matters to users?

### 03-sync-behind-own-async

**What it models:** a user whose own batch job is queued when they send an interactive request.

**Setup:** Alice and Bob each have an async job of 400 granules (about 2 minutes each). Ten minutes
in, Bob also sends a 1 granule sync request (1 minute).

**Good outcome:** Bob's sync request finishes quickly - it shouldn't wait behind Bob's own async work -
and Alice and Bob each get about half the service.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| bob-sync makespan | 1m 38s | 1m 33s | 1m 13s | -21%, better in 4, worse in 1 of 5 |
| contended fairness | 0.98 | 0.98 | 0.98 | +1%, **better in 5/5 seeds** |

**For reviewers:** should a user's sync request always go ahead of their own async work, even if
that puts them over their fair share for a moment? (`adaptive-fast-lane` says yes.)

### 04-crowded

**What it models:** a busy service with many users whose work items take very different times.

**Setup:** eight users. Carol's work items take about 30 seconds, Dan's about 8 minutes, and the
other six users' about 2 minutes; Bob has 300 granules, everyone else 150. Fifteen minutes in, Bob
also sends a 1 granule sync request.

**Good outcome:** every user gets close to their fair share of pods however long their work items
take, and Bob's sync request finishes quickly. Carol can show a low fair share even when served
well, because fair share is measured in pods and Carol's work items are short.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| contended fairness | 0.86 | 0.82 | 0.92 | +11%, **better in 5/5 seeds** |
| bob-sync makespan | 1m 51s | 1m 38s | 1m 25s | -13%, better in 3, worse in 2 of 5 |

**For reviewers:** is fairness in pods the right measure, or should a user with short work items
count as served when their work keeps moving, even with fewer pods?

### 05-newcomer

**What it models:** a new user arriving at a service that's already shared.

**Setup:** six users each have a job of 200 granules (about 2 minutes each). Twenty minutes in, Erin
submits a small job of 50 one-minute work items.

**Good outcome:** Erin's small job gets going promptly without starving anyone, and the six existing
users share the service evenly. The story notes that even sharing and a low average slowdown pull
against each other here (equal sharing makes equal jobs all finish late together).

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| erin-1 slowdown | 9.83 | 10.21 | 6.86 | -33%, **better in 5/5 seeds** |
| max job slowdown | 9.83 | 10.21 | 6.86 | -33%, **better in 5/5 seeds** |

No policy gets Erin going promptly yet: Erin's job takes about 7 times as long as it could. A
"catch-up boost" for users who've had little of the service lately has been tried in an earlier
version (see [POLICY-DESIGN.md](POLICY-DESIGN.md#considered-and-not-done)).

**For reviewers:** should a newcomer get more than an equal share for a while, at the existing
users' expense? Or is an equal share from the moment they arrive the right behavior?

### 06-slow-vs-fast

**What it models:** slow work and fast work competing - the problem the fast lane reserve exists
to solve.

**Setup:** Frank submits 60 work items that take about 30 minutes each. Five minutes later, Gina and
Hank each submit 300 one-minute work items.

**Good outcome:** Gina's and Hank's fast work starts promptly and keeps flowing while Frank's slow
work runs, with Frank never holding more than 70% of the pods once Frank's work is known to be slow.
Frank finishing later is the expected price, as are pods held in reserve after the fast work is
done.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| gina-fast slowdown | 7.56 | 7.36 | 3.16 | -57%, **better in 5/5 seeds** |
| hank-fast slowdown | 7.38 | 7.16 | 3.14 | -56%, **better in 5/5 seeds** |

`duration-based` does barely better than `slot-based` here because Frank's work fills the service
before Frank's first work item finishes and shows it's slow.

**For reviewers:** is 30 minutes typical of Harmony's slow services? How long do slow and fast
work items really take?

### 07-slow-alone

**What it models:** what the fast lane reserve costs when no fast work arrives.

**Setup:** Frank is the only user, with 100 work items of about 30 minutes each.

**Good outcome:** Frank gets as much of the service as the policy allows. Under the fast lane
policies that's 70% of the pods, and the reserved 30% staying idle is by design, so that fast work
arriving later never finds every pod taken.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| frank-slow makespan | 2h 51m | 3h 46m | 4h 09m | +10%, **worse in 5/5 seeds** |

`adaptive-fast-lane` is slower than `duration-based` because it enforces the reserve from the
start; `duration-based` lets Frank's work overshoot it until the first of Frank's work items finishes.

**For reviewers:** is 30% the right reserve, and is roughly 45% longer for a slow user alone (vs.
`slot-based`) acceptable? How often is a slow service used by one user alone?

### 08-many-jobs

**What it models:** one user splitting their work into many jobs.

**Setup:** Ivan has four jobs and Judy one, each of 150 two-minute work items.

**Good outcome:** Ivan and Judy each get about half the service while both have work, rather than
Ivan getting four times Judy's share because Ivan submitted four jobs.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| judy fair share | 0.40 | 0.40 | 0.95 | +137%, **better in 5/5 seeds** |
| contended fairness | 0.74 | 0.74 | 0.97 | +31%, **better in 5/5 seeds** |

**For reviewers:** should fairness be between users, as here, or are there users (e.g. operational
pipelines) who should get more?

### 09-slowdown-drift

**What it models:** a job whose work gets much slower part way through.

**Setup:** Kim's job has 1,200 work items: the first 1,000 take about a minute, the last 200 about
20 minutes. Lee submits a new job of 100 one-minute work items every 15 minutes for 5 hours.

**Good outcome:** once Kim's work items become slow, the scheduler notices within a few completions
and limits them, so Lee's stream of fast jobs keeps flowing. Pods held in reserve once Kim is
limited are expected.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| lee mean slowdown | 21.75 | 21.84 | 3.03 | -86%, **better in 5/5 seeds** |
| lee max slowdown | 43.24 | 43.23 | 6.99 | -84%, **better in 5/5 seeds** |

`duration-based` never classifies Kim as slow, because the lifetime average of Kim's durations stays
low.

**For reviewers:** do real jobs change speed part way through like this (e.g. a change in granule
size or region)? How suddenly?

### 10-multi-granule-sync

**What it models:** a sync request bigger than production allows today, as if a service raised its
maximum sync granules.

**Setup:** as story 02, but Bob's sync request has 4 granules (1 minute each).

**Good outcome:** Bob's request finishes close to its 1 minute minimum, without noticeably delaying
Alice.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| bob-sync makespan | 1m 47s | 1m 50s | 1m 38s | -11%, better in 4, worse in 1 of 5 |
| alice-big makespan | 1h 05m | 1h 05m | 1h 06m | +2%, **worse in 5/5 seeds** |

**For reviewers:** are multi-granule sync requests likely enough to keep this story in the
benchmark suite, or should it be dropped?

### 11-new-slow-pair

**What it models:** new slow jobs whose slowness isn't known yet, with fast work arriving soon
after.

**Setup:** Frank and Mia each submit 60 work items of about 30 minutes at the same time. Nobody knows
yet that their work is slow. Five minutes later, Gina submits 300 one-minute work items.

**Good outcome:** Gina's fast work starts promptly and keeps flowing, with the reserve free for Gina's
work when it arrives. Once Frank's and Mia's work is known to be slow, the three users share the
service fairly. Frank and Mia finishing later is the expected price.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| gina-fast slowdown | 12.47 | 4.78 | 1.99 | -58%, **better in 5/5 seeds** |
| contended fairness | 0.72 | 0.89 | 0.94 | +5%, **better in 5/5 seeds** |

**For reviewers:** the goal puts Gina first. `adaptive-fast-lane` could instead let Frank's and
Mia's work out of its new-job limit as soon as it's seen to be slow: Gina would be about a third
slower, and fairness 1.5% better (see [POLICY-DESIGN.md](POLICY-DESIGN.md#judgment-calls)).
Which matters more?

### 12-occasional-long-items

**What it models:** a job that's fast on average but has occasional long work items.

**Setup:** three users start together. Kim has 80 work items of about 30 minutes (genuinely slow).
Nora has 400 work items: most take about 2 minutes, but 1 in 20 takes about 20 minutes, averaging
about 3 minutes (fast). Omar has 400 one-minute work items.

**Good outcome:** Nora is treated as a fast user - the occasional long work items don't hold up
the rest of Nora's work or cost Nora a fair share - and Nora's slowdown is close to Omar's.
Kim's slow work stays within the slow work capacity, and Omar's fast work keeps flowing.

| metric | slot-based | duration-based | adaptive-fast-lane | adaptive vs duration-based |
|---|---|---|---|---|
| nora-mixed slowdown | 3.66 | 3.67 | 2.74 | -25%, **better in 5/5 seeds** |
| nora fair share | 0.74 | 0.80 | 0.92 | +14%, **better in 5/5 seeds** |
| omar-fast slowdown | 9.69 | 9.67 | 3.20 | -67%, **better in 5/5 seeds** |

**For reviewers:** is "1 in 20 work items takes ten times as long" a realistic mix? Do some
services have much heavier tails?

## The mixed workload

`scenarios/mixed-workload.yml` isn't one of the benchmark stories (each run takes several minutes),
but it's the closest scenario to a real day, and none of the policy fixes were tuned on it.

**Setup:** over six hours, users submit jobs at random intervals to a two step chain, a 30 pod
subsetter followed by a 10 pod reformatter:

- **pipeline** - a big job every 30 minutes on average: 300-600 granules, about 2 minutes on the
  subsetter and 20 seconds on the reformatter.
- **analyst** - every 20 minutes: 20-200 granules, about 90 seconds and 20 seconds.
- **student** - every 45 minutes: 5-60 granules of about a minute, subsetter only.
- **modeler** - every 90 minutes, from 30 minutes in: 10-40 granules on the subsetter, three in
  four taking about 25 minutes and the rest about 3 minutes.
- **viewer** - a 1 granule sync request every 4 minutes: about 20 seconds and 10 seconds.

**Good outcome:** sync requests stay fast, users with small jobs aren't stuck behind the pipeline's
big jobs, the occasional slow modeler jobs don't take over the subsetter, and overall slowdown is
low.

Results over seeds 101-103 (from a run on 2026-11-04; `adaptive-fast-lane` vs `duration-based`):
better in all 3 seeds on mean job slowdown (-30%), worst job slowdown (-37%), mean sync makespan
(-31%), worst sync makespan (-50%) and contended fairness (+10%), for 0.1% less utilization.

**For reviewers:** this is the scenario most worth making realistic. What does a busy day on a real
Harmony service look like - which users, how many jobs, what sizes, how often? Could it be built
from production job history?

## What the scenarios don't cover

Known gaps, in the scenarios and in the simulator:

- **A service whose queue backs up**, so work items wait on pods before running.
  `adaptive-fast-lane`'s fix 5 (using the pod's own timing) can't be judged without one.
- **Autoscaling.** Pod counts are fixed.
- **Small and very large services.** Every story uses 20 pods; an earlier round of experiments
  also tried 4 and 80 pods, but those scenarios aren't in the suite.
- **Failures and retries**, slow work in a chain's second step, and bursts of sync requests -
  also tried in that earlier round, not in the suite.
- **Parts of Harmony the simulator doesn't model:** query-cmr, aggregation and batching steps,
  cancellation and pausing, work-failer timeouts, and concurrent scheduler pods (it runs one event
  at a time, on sqlite rather than Postgres). See [REFERENCE.md](REFERENCE.md#limitations).
- **Real traffic.** All scenarios are synthetic.

**For reviewers:** which of these matter most for a sandbox or UAT trial? Are there real incidents
(e.g. a service taken over by one user) that should become stories?
