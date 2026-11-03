# Fair queueing simulator reference

Details behind [README.md](README.md), which covers running the simulator and developing a policy.

- [Scenario format](#scenario-format)
- [Policies](#policies)
- [Output files](#output-files)
- [Interpreting the results](#interpreting-the-results)
- [Benchmark records](#benchmark-records)
- [Checking that a change doesn't alter behavior](#checking-that-a-change-doesnt-alter-behavior)
- [Writing up findings](#writing-up-findings)
- [How it works](#how-it-works)
- [Limitations](#limitations)

## Scenario format

A scenario is a YAML file describing the simulated cluster (services and their pod counts, plus
how quickly the Harmony components around the scheduler react) and the workload (jobs submitted
by users, each a chain of service steps with a duration distribution for their work items).

```yaml
name: slow-vs-fast              # used for the output directory
description: Free text shown in the reports - what the scenario tests.
goodOutcome: >-                 # what a good result looks like, shown in the reports to guide interpretation
  Fast work keeps flowing while slow work runs; slow work never holds more than 70% of the pods.
benchmarks:                     # optional: the protected metrics, which express goodOutcome (see below)
  - metric: job.gina-fast.slowdown
    note: fast work keeps flowing while slow work runs   # shown in the report
    # better: lower             # only if this scenario's better direction isn't the metric's usual one
seed: 6                         # every random draw derives from this (default 1)
maxDuration: 2d                 # stop here even if jobs are still running (default 7d)
policy: slot-based              # default policy for `run` (optional)

env:                            # environment variables (as with --set)
  QUEUE_LONG_POLLING_WAIT_TIME_SEC: 3

infrastructure:                 # all optional; these are the defaults
  schedulerPods: 1              # work-scheduler pods (affects how the scheduler sizes batches)
  updaterPods: 1                # work-updater pods for the small work item update queue
  schedulerWakeLatency: 50ms    # delay before an idle scheduler notices a scheduling request
  schedulerPassTime: 200ms      # virtual time one scheduler pass takes
  updaterWakeLatency: 50ms      # delay before an idle updater notices a work item update
  updaterBatchTime: 100ms       # virtual time one batch of work item updates takes
  podReceiveLatency: 50ms       # delay before a long-polling pod receives a newly queued item
  podPollInterval: 500ms        # service-runner's pause between asking Harmony for work
  sampleInterval: 30s           # how often the system state is sampled for the charts/metrics (at least 1s, and at most 100,000 samples over maxDuration)

services:
  - name: svc                   # how jobs refer to the service
    pods: 20
    # id: harmonyservices/my-service:1.0   # Harmony service ID (default harmonyservices/sim-<name>:latest)

jobs:
  - name: frank-slow            # must be unique
    user: frank
    granules: 60                # number of work items for each step (or { min: 10, max: 100 })
    async: true                 # default true; false makes it a synchronous request
    submitAt: 0s                # default 0
    ignoreErrors: true          # default true; false fails the job when work items exhaust their retries
    steps:                      # services in chain order; each item's output feeds one item of the next step
      - service: svc
        duration: { dist: lognormal, median: 30m, sigma: 0.2 }
        failureRate: 0.01       # probability an attempt fails (Harmony retries it); default 0
        phases:                 # optional: a different duration from a given work item index onwards
          - { fromItem: 50, duration: 2h }

generators:                     # optional: streams of similar jobs
  - name: lee                   # jobs are named lee-1, lee-2, ...
    user: lee
    start: 0s                   # time of the first job (default 0)
    every: { dist: exponential, mean: 15m }   # time between jobs
    until: 5h                   # stop at this time, and/or after `count:` jobs
    job:                        # same fields as a job, minus name/user/submitAt
      granules: { min: 10, max: 100 }
      steps:
        - service: svc
          duration: 1m
```

**Durations** are a number of milliseconds or a string with a unit: `250ms`, `30s`, `10m`,
`2h`, `1d`. **Duration distributions**:

| Form | Meaning |
|---|---|
| `30s` or `{ dist: fixed, value: 30s }` | always this long |
| `{ dist: uniform, min: 30s, max: 90s }` | uniformly between min and max |
| `{ dist: exponential, mean: 2m }` | exponential (good for arrival intervals) |
| `{ dist: lognormal, median: 2m, sigma: 0.3 }` | lognormal - a realistic shape for work item durations; `sigma` 0.2-0.5 is a modest spread |
| `{ dist: mix, options: [{ weight: 3, duration: 25m }, { weight: 1, duration: 3m }] }` | a weighted mix of other distributions (e.g. mostly slow, sometimes fast) |

Jobs are created the way Harmony creates them for a real request (the job, its workflow steps,
`user_work` rows, the first step's work items, then a scheduling request), except that the first
step is the job's first listed service rather than query-cmr. Each work item produces one output,
which becomes one work item of the next step.

### Protected metrics

A scenario's `benchmarks:` list names the metrics that say whether its `goodOutcome` was
achieved. `bench` highlights them. The names (defined in `src/bench-metrics.ts`):

| Metric | Better | Meaning |
|---|---|---|
| `overall.meanSlowdown`, `overall.maxSlowdown` | lower | mean / max slowdown over all jobs |
| `sync.meanMakespan`, `sync.maxMakespan` | lower | makespan of the synchronous requests |
| `fairness` | higher | contended fairness (mean over services) |
| `utilization` | higher | pod utilization (mean over services) |
| `idlePodHours` | lower | pod-hours idle while work was ready |
| `simulatedTime` | lower | time until every job finished |
| `job.<job>.makespan`, `job.<job>.slowdown`, `job.<job>.meanWait` | lower | one job's makespan, slowdown, and mean wait for a pod |
| `user.<user>.fairShare` | higher | one user's fair share while competing (give `better: lower` for a user who should get *less*) |
| `user.<user>.meanSlowdown`, `user.<user>.maxSlowdown` | lower | one user's mean / max job slowdown |

Keep a scenario's accepted costs out of its protected metrics, or say so in the `note` (as
07-slow-alone does).

## Policies

A **fair queueing policy** decides which jobs get work items, and how many, each time the
work-scheduler fills a service's queue. Everything else - fetching the work items, marking them
queued, keeping `user_work` counts right, sending them to the queue - is shared code, so policies
can't get the bookkeeping wrong and can be swapped freely.

### The policy interface

Policies implement `FairQueueingPolicy` from
`services/harmony/app/backends/workflow-orchestration/fair-queueing-policy.ts`:

```ts
export interface FairQueueingPolicy {
  name: string;
  scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void>;
}
```

**`scheduleWork`** is called once per scheduling batch (from `getWorkItemsFromDatabase`, inside
its database transaction). `batchSize` is the most work items to hand out in total. `context`
has the number of pods running the service (`servicePodCount`), the work-scheduler's fast lane
settings (`slowWorkThresholdMs`, `fastLaneReserveFraction`) and a `logger`. The policy picks jobs
and calls **`takeWorkItems(jobID, maxItems)`** for each, in priority order; it returns how many
work items it actually got (possibly fewer, if the job ran out), so the policy can redistribute
what's left.

The work-scheduler picks the policy (`processSchedulerQueue` in
`services/work-scheduler/app/workers/scheduler.ts`) and passes it to `getWorkItemsFromDatabase`;
the simulator replaces that choice with the policy you ask for, and passes the work-scheduler's
`context` to it unchanged. A policy can also have a **sampler** in `loadPolicies`
(`src/policies/index.ts`): a function returning numbers to record in every sample (e.g. how much
slow work is running), which appear as extra rows in the reports. Neither of Harmony's policies
has one.

### Postgres and sqlite

`tx` is a transaction on Postgres in production and on sqlite in the simulator and Harmony's
tests. `DATABASE_TYPE` chooses between them (`db/knexfile.js`: `sqlite` for sqlite, anything else
for Postgres). Prefer knex's query builder, which generates the right SQL for either. Where raw
SQL has to differ, check the connection the way `services/harmony/app/models/user-work.ts` does:

```ts
import db from '../../../../services/harmony/app/util/db';

// sqlite doesn't support SKIP LOCKED; it's only needed for concurrent scheduler pods on Postgres
const lockClause = db.client.config.client === 'pg' ? 'FOR UPDATE OF uw SKIP LOCKED' : '';

const results = await tx.raw(sql, bindings);
// pg's tx.raw() returns { rows: [...] }; sqlite's returns the row array directly
const rows = db.client.config.client === 'pg' ? results.rows : results;
```

Test for `'pg'`, not for `'sqlite3'`: the simulator supplies its own sqlite client class (see
`configureDatabaseFile` in `src/bootstrap.ts`), so `client` isn't the string `'sqlite3'` there.
Postgres-only behavior, such as `SKIP LOCKED` or advisory locks between scheduler pods, never runs
in the simulator, so the simulator can't tell you whether it works.

### Available policies

| Policy | What it does |
|---|---|
| `slot-based` | Harmony's default algorithm (`slotBasedPolicy` in `fair-queueing-policy.ts`). Picks up to `batchSize` jobs interleaved round robin by user, with a user's sync jobs before their async ones and the users with the fewest running work items for the service first; shuffles them; splits the batch evenly per job. No knowledge of work item durations. |
| `duration-based` | Harmony's algorithm when `ENABLE_DURATION_BASED_FAIR_QUEUEING` is true (`durationBasedPolicy` in `fair-queueing-policy.ts`). Users are ranked within each round by the expected runtime of their in-progress work for the service (running items x the job's duration), and work for a (job, service) whose duration is above `SLOW_WORK_THRESHOLD_MS` may only occupy `1 - FAST_LANE_RESERVE_FRACTION` of the service's pods, reserving the rest for fast work. See `docs/fair-queueing.md` for how durations are measured and seeded. |

### The fast lane reserve leaves pods idle on purpose

`duration-based` keeps `FAST_LANE_RESERVE_FRACTION` of each service's pods away from slow work
**even when nothing else is waiting**. This is deliberate: Harmony has seen slow jobs take
every pod of a service and leave newly arriving fast jobs unworked, and the reserve guarantees
that can't happen. So when only slow work exists (story 07, and the end of stories 06 and 09),
"idle while work ready" goes up and slow jobs take longer - that's the cost of the guarantee, not
a bug, and policy changes shouldn't "fix" it by letting slow work use the reserve. The policy's
design note says this in every report. Policies with a reserve that serve fast work faster show
more of this idle time, not less: they clear the fast work between arrivals, so there are more
stretches where only slow work is waiting.

### Policy settings

Policies read their settings from environment variables, so set them in a scenario's `env:` or
with `--set`. Harmony's two policies get theirs from the work-scheduler, which reads them when it
starts; their defaults are in `services/work-scheduler/env-defaults`:

| Variable | Default | Used by | Meaning |
|---|---|---|---|
| `SLOW_WORK_THRESHOLD_MS` | `600000` (10 min) | `duration-based` | a (job, service) whose work item duration is above this is "slow" |
| `FAST_LANE_RESERVE_FRACTION` | `0.3` | `duration-based` | fraction of a service's pods slow work may not use |

`ENABLE_DURATION_BASED_FAIR_QUEUEING` has no effect in the simulator, which always uses the policy
you ask for - except with `--policy native` (see [Writing up findings](#writing-up-findings)).

`--set` applies to every policy in a `compare`, so to compare two settings of the same policy,
run it twice with different `--out` directories (or use `bench`, which compares each run with the
policy's recorded results).

## Output files

Each run writes these to `output/<scenario>/<policy>/` (or its `--out` directory):

| File | Contents |
|---|---|
| `report.md` | the run's summary: per service, per user and per job metrics |
| `summary.json` | the same, as JSON (what `compare` builds its reports from), plus the run's **provenance**: git commit and branch, whether the files that can affect results had uncommitted changes (which files, and a hash of the changes), the seed, the scenario file, every policy setting including defaults, environment overrides, Node version and when it ran |
| `decisions.ndjson` | the **decision log** - one line per scheduling batch: time, service, batch size, and the `[job, items requested, items received]` the policy took, in order |
| `runs.ndjson` | every work item attempt: work item, job, user, service, step, pod, start and end time, status |
| `samples.ndjson` | the state of each service every `sampleInterval`: ready work and running work (per `user_work`) per user, pods busy per user, queue length, and any policy specific values |
| `work-items.ndjson` | the final state of every work item, from the database (created / queued / done times, duration, retries) |
| `harmony.log` | Harmony's own log at `--log-level` (warnings and up by default) |
| `sim.sqlite3` | the database at the end of the run |

`bench` puts its runs in `output/bench/runs/<policy>/<scenario>/seed-<n>/`.

Times are milliseconds since the start of the simulation. The `.ndjson` files have one JSON object
per line, which is easy to explore with `jq`:

```fish
# the scheduling decisions in the second hour
jq -c 'select(.t >= 3600000 and .t < 7200000)' output/04-crowded/slot-based/decisions.ndjson

# pods per user every ~10 minutes
jq -c 'select(.t % 600000 < 30000) | {min: (.t / 60000 | floor), busy: .services[0].busyByUser}' output/06-slow-vs-fast/duration-based/samples.ndjson
```

## Interpreting the results

### The comparison report

Every report starts with the policies' descriptions and design notes, and ends (or, in the HTML,
has a "How to read this report" panel) with a glossary of the metrics, so it can be read on its own.
`comparison.html` then has one section per scenario:

- **What a good result looks like** - the scenario's `goodOutcome`: judge the policies against
  this, not against each other alone.
- **Produced by** - the code (commit, plus a hash of any uncommitted changes) and seed. If the runs
  being compared weren't made from the same code, seed and overrides, the section says **Not a
  like for like comparison** and lists what each run used.
- **Charts** - one per service and policy, side by side on the same time axis. Each colored band
  is the number of pods running that user's work; the top of the chart is the service's pod
  count, so white space below the top is idle pods. Hover over a chart (or focus it and use the
  arrow keys) to read the values at a point in time. "Table view" lists the same data every ten
  minutes.
- **Overall**, **Users** and **Jobs** tables - one row per metric, user (fair share and mean
  slowdown) or job (makespan and slowdown; for scenarios with up to 30 jobs), one column per policy.

`comparison.md` has the same tables without the charts. Each run's `report.md` has more detail
(e.g. wait times per job).

### The benchmark report

`bench.md` starts with what produced it, where the baseline's (`slot-based`'s) values came from
(its record, or run afresh and why) and what each policy is compared with. Then:

- **Protected metrics** - every scenario's protected metrics, one row each.
- **One section per scenario** - its goal, its protected and scenario wide metrics, and
  (collapsed) every job's and user's metrics.

Values are the mean over the seeds with the range across seeds in brackets. **vs slot-based** and
**vs recorded** compare seed by seed - runs with the same seed have the same work item durations -
and count the seeds the policy did better and worse in: **better in 5/5 seeds** is a real
difference, a mixed count is noise, and "same" means identical in every seed.

### The metrics

| Metric | Meaning | Good value |
|---|---|---|
| **makespan** | time from a job's submission to its completion | lower |
| **slowdown** | makespan divided by a lower bound on how long the job would take with the cluster to itself (for each step, the longer of its longest work item and its total work spread perfectly over the service's pods) | 1.0 is as fast as possible; 2.0 means it took twice as long as it could have |
| **wait** | time from a work item being ready to a pod starting it | lower |
| **sync makespan** | makespan of synchronous requests - what an interactive user waits for | lower |
| **fair share** (per user) | while the user was competing with at least one other user for a service: the pods running their work divided by their *max-min fair share* of the pods. The fair share is an equal split of the pods, except that users who want fewer than that get what they want and the rest is split among the others | 1.00 is exactly fair; below 1 the user was short-changed; above 1 they got more than their share |
| **contended fairness** (per service) | Jain's fairness index of those per-user ratios, averaged over the samples where two or more users wanted the service | 1.0 means every competing user had exactly their share |
| **utilization** | pod time spent running work divided by pods x simulated time | higher, but it also drops simply because the service runs out of work near the end |
| **idle while work ready** | pod-hours spent idle while the service had work ready or queued | ~0 for policies without a reserve; anything substantial there means pods are being left unused. For policies with a fast lane reserve, idle time while only slow work is waiting is the reserve doing its job (see [above](#the-fast-lane-reserve-leaves-pods-idle-on-purpose)) |
| **policy rows** | values the policy's sampler recorded, for policies that have one: maximum and time-weighted mean | depends on the policy - e.g. a count of slow work items running above the slow work capacity would mean slow work got past the cap |

### Reading them together

- **Fairness and speed pull in different directions.** Sharing a service exactly evenly between
  equal jobs makes them all finish at about the same - late - time, whereas serving some first
  finishes those sooner and lowers the mean makespan. So a policy can improve fair share while
  slightly worsening mean slowdown (story 05 shows this). Decide which matters for the scenario.
- **Look at the charts as well as the makespans.** When the same total work has to be done either
  way, makespans can be almost identical even though one policy lets fast work make steady
  progress and the other starves it until the slow work is done (story 06). The charts and the
  wait times show the difference.
- **Fair share is measured in pods, not in work done.** A user whose work items are very short
  holds few pods at any moment even when they're being served well, so they can look
  short-changed (`carol` in story 04).
- **Idle while work ready points at policies holding work back** - deliberately (a reserve) or
  not. It's the first thing to check when a policy's makespans are worse than expected. If it's
  the fast lane reserve with only slow work waiting, that's intended.
- **Judge against the scenario's goal.** A policy that "wins" on a metric the scenario doesn't care
  about hasn't necessarily done better.
- **Find out why.** When a result is surprising, look at that run's `samples.ndjson` around the
  time it happened (who had pods, who had work ready), then `decisions.ndjson` (what the policy
  chose).

### Is a difference real, or noise?

Runs are deterministic: the same scenario, policy and seed always produce identical output, and
work item durations are drawn per work item, so they're the same under every policy. But the
order in which the scheduler happens to pick jobs still differs between policies, so small
differences - a few percent, or a few seconds on a short job - can be noise from a single seed.
`bench` handles this by running five seeds and comparing seed by seed; with `compare`, rerun with
a few `--seed` values, or use `findings --seeds`, which summarizes how often each policy came out
best.

**A single sync request's makespan is especially noisy.** Stories 02, 03, 04 and 10 each have one
sync request lasting a minute or two, so nearly any change moves it by up to about 15%, with mixed
seed counts. Only trust a difference there that holds in 5 (or at least 4) of 5 seeds. Production
sync requests are 1 granule (`MAX_SYNCHRONOUS_GRANULES`); story 10's 4 granule request is a stress
case.

### Getting Claude Code to interpret the results

Claude Code can read every output file. The reports carry what it needs to interpret them -
each scenario's goal, the policies' design notes, the metric definitions and the provenance - and
this file has the rest. Say which scenarios and policies you care about and what "better" means
to you (fastest sync requests, nobody starved, best average turnaround), for example:

- *"Read tools/fair-queueing-sim/output/bench/bench.md and explain where my-policy is worse than
  slot-based and why."*
- *"In story 06, why do gina and hank finish at about the same time under both policies? Use the
  samples.ndjson files in tools/fair-queueing-sim/output/06-slow-vs-fast/ to show how many pods
  each user had over time."*
- *"Compare the decisions.ndjson files for 04-crowded under slot-based and duration-based and
  explain the first pass where they choose differently."*
- *"Read tools/fair-queueing-sim/output/findings/findings.md and write its Conclusions section."*

## Benchmark records

### What gets recorded, and where

These live in `benchmarks/` and are committed:

| File | Contents |
|---|---|
| `suite.yml` | the benchmark suite: the scenarios, the seeds (101-105), any settings, and the **tracked** policies - the baseline, `slot-based`, and the candidates |
| `results/<policy>.json` | a policy's recorded results: every metric for every scenario and seed, plus what produced them (commit, a hash of the code that affects results, settings, Node version, platform) |

`bench --label <name>` saves the same kind of file to
`output/experiments/<date>-<name>/<policy>.json`, as a local log of what each version of a policy
achieved. Like everything in `output/`, it isn't committed: nothing reads these files back, and
they're usually made from uncommitted code, so a write-up in the PR or Jira ticket with the
command that reproduces an experiment is the place to keep one worth keeping.

`bench --record` runs the whole suite for the tracked policies (or `--policies`) and writes their
`results/` files, so it can't be combined with scenario files, `--seeds` or `--set`. The history of
`results/slot-based.json` and `results/duration-based.json` is the history of production fair
queueing.

### When baseline is rerun

Runs are deterministic, so the baseline's (`slot-based`'s) recorded results stay valid until
something that could change them changes. Until then `bench` doesn't rerun it; after that it runs
it afresh, and the report says why and how to record it again. It's rerun when:

- **the code that affects results has changed**: Harmony's scheduling code, the work-updater,
  `db/`, `packages/util`, or the simulator itself - everything in `RESULT_PATHS` in
  `provenance.ts`. Other policies' files, the policy registry (`policies/catalog.ts`,
  `policies/index.ts`) and the files that only present results (`bench.ts`, `findings.ts`,
  `report.ts`, `report-html.ts`) are left out, so working on a policy never makes the baseline's
  record stale. A policy's own code is `src/policies/<name>.ts` plus whatever it imports from
  `src/policies/`, which is why a policy's file must be named after it;
- **a scenario has changed** - its description, `goodOutcome`, `benchmarks:`, `seed` and
  `policy` don't count;
- **a seed isn't in the record** (e.g. `--seeds 999`);
- **a `--set` could affect it**. Settings only other policies read (in their catalog entry, and
  not in any of Harmony's `env-defaults`) don't; settings Harmony reads, such as
  `SLOW_WORK_THRESHOLD_MS`, do.

A policy is compared with its own record whenever its scenarios, seeds and settings match - its
code having changed is the point - and the report says whether its code has changed since. If the
code hasn't changed, every value should be "same"; a difference means the runs weren't
reproducible (e.g. a different platform or Node version from the one that recorded them).

## Checking that a change doesn't alter behavior

Because runs are deterministic, the decision log works as a regression check for refactoring
Harmony's scheduling code or porting a policy. Run the same scenarios before and after the change,
into different output directories, and compare `decisions.ndjson`, `runs.ndjson` and
`work-items.ndjson` - they should be identical:

```fish
npm run sim -- compare scenarios/stories/*.yml --policies slot-based --out /tmp/before
# ... make the change ...
npm run sim -- compare scenarios/stories/*.yml --policies slot-based --out /tmp/after
for d in /tmp/before/*/slot-based
    set s (basename (dirname $d))
    cmp -s $d/decisions.ndjson /tmp/after/$s/slot-based/decisions.ndjson; and echo "$s same"; or echo "$s DIFFERENT"
end
```

To check a policy against another branch's *own* code (e.g. a port), use `findings --references`
(below), which does the equivalent of this against a checkout of that branch. The special policy
`native` leaves the work-scheduler's own choice of policy alone (or, in a version of Harmony
without the policy interface, its built-in scheduling code), which is how those checks work.

## Writing up findings

When a comparison is worth sharing or acting on, `findings` produces a write-up with the evidence
behind it:

```fish
npm run sim -- findings scenarios/stories/*.yml --seeds 101,102,103 --references main=slot-based
```

It runs (several at a time; the command above takes 20-30 minutes):

1. **The comparison** - every scenario under every policy (`--policies` to choose), into
   `output/findings/main/` with the usual `comparison.md` / `comparison.html`.
2. **Other seeds** (`--seeds`) - the same comparison with each seed, into `output/findings/seeds/`.
3. **Each feature switched off in turn** - for every policy whose catalog entry lists `variants`,
   into `output/findings/variants/`.
4. **Validation checks**, into `output/findings/checks/`:
   - **determinism** - the first policy run twice gives identical logs;
   - **equivalences** - for every policy whose catalog entry has `equivalentTo`, that it makes
     exactly the same decisions as the other policy under the stated settings (e.g. a policy
     whose features can all be switched off, with them all off = the policy it extends);
   - **references** (`--references REF=POLICY`) - that POLICY here makes exactly the same decisions
     as the scheduling code built into git ref REF. The simulator extracts REF's code into a
     temporary directory and runs it with the `native` policy, so the work-scheduler picks the
     policy as it does in production: `main=slot-based` checks the simulator's `slot-based`
     against `main`, and `--set ENABLE_DURATION_BASED_FAIR_QUEUEING=true` with
     `main=duration-based` checks `duration-based`. `@file;file` copies those files from your
     checkout over REF's first, for code REF can't run under the simulator as it is.

and then writes `output/findings/findings.md` with: what produced it (command, commit,
uncommitted changes), the policies and their design notes, each scenario's goal, the
**Conclusions**, the results, robustness across seeds (mean, range and how often each policy was
best, per metric), what each feature contributes, and the validation results.

**Conclusions** are the one part a person (or Claude Code) writes. Everything else is regenerated
each time `findings` runs, but the Conclusions are kept. They're stamped (in a comment) with the
code they were written for; if `findings` is rerun on different code, it flags them for review at
the top of the section. After reviewing, update the stamp as the flag says.

`output/` is ignored by git, so to share findings, copy `findings.md` (and `main/comparison.html`
for the charts) somewhere permanent. They record the commit they came from, so anyone can check
out that commit and rerun the command to reproduce them.

## How it works

The simulator is a discrete-event simulation: a queue of timed events (a pod finishing a work
item, a scheduler pass, a job being submitted, ...) processed one at a time in time order. While
an event runs - including all of the Harmony code and database work it triggers - the virtual
clock stands still; between events it jumps straight to the next one. So a 30 minute work item
costs no more to simulate than a 30 second one.

| Real system | In the simulator |
|---|---|
| service pods running service-runner | `Pod` actors (`src/actors.ts`) that ask for work through Harmony's real `getWorkFromQueue`, long poll the service queue when there's none, "run" each work item for a duration drawn from the scenario, then report the result through the work item update queue as Harmony's `PUT /service/work/:id` handler does |
| work-scheduler pods | a worker pool that runs the work-scheduler's real `processSchedulerQueue` whenever there are scheduling requests |
| work-updater pods | a worker pool that runs the work-updater's real `batchProcessQueue` whenever there are work item updates |
| SQS queues | in-memory queues (`src/sim-queue.ts`) |
| k8s pod counts | the scenario's pod counts |
| S3 / STAC catalogs | stubbed - simulated services don't write outputs |
| Postgres | sqlite, built fresh from `db/db.sql` for each run |
| wall clock | `Date` and `performance.now` replaced by a virtual clock |
| randomness | `Math.random` seeded from the scenario seed; all simulated randomness drawn from streams keyed by what it's for |

The stubs are in `src/harness.ts`, job creation in `src/workload.ts`, the actors in
`src/actors.ts`, the event loop in `src/engine.ts` and `src/simulation.ts`, the metrics in
`src/metrics.ts` and the reports in `src/report.ts` and `src/report-html.ts`. `src/bootstrap.ts`
does the setup that has to happen before any Harmony module loads (environment, database file,
virtual clock). `src/batch.ts` runs many simulations at once, `src/findings.ts` is the `findings`
command, `src/bench.ts` and `src/bench-metrics.ts` the `bench` command, `src/provenance.ts`
records what produced each run, and `src/policies/` has the policies (`catalog.ts` describes
them; `index.ts` loads them).

## Limitations

- Everything runs one event at a time, so races between concurrent scheduler or updater pods
  (and the effect of `SKIP LOCKED`) aren't modeled.
- The database is sqlite, not Postgres. The scheduling SQL runs on both, but query plans and some
  edge cases (e.g. NULL ordering) differ, and query performance tells you nothing about Postgres.
- No query-cmr step, aggregation, batching, cancellation, pausing or work-failer timeouts yet.
- Pod counts are fixed - no autoscaling model yet.
- SQS FIFO partition behavior (a long poll missing a message that arrives on another partition)
  isn't modeled; a waiting pod always receives the next message.
- Harmony code takes no virtual time; scheduler and updater passes take the configured fixed
  times instead.
