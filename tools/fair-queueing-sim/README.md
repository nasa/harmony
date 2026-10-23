# Fair queueing simulator

A discrete-event simulator for trying out Harmony's fair queueing policies much faster than real
time. It runs Harmony's **real** scheduling and work item update code against a real (sqlite)
database, with simulated service pods and a virtual clock, so hours of activity - including
services whose work items take hours - simulate in seconds, and different fair queueing policies
can be compared on exactly the same workload.

- [Quick start](#quick-start)
- [Setup](#setup)
- [Running simulations](#running-simulations)
- [Scenarios](#scenarios)
- [Policies](#policies)
- [Output files](#output-files)
- [Interpreting the results](#interpreting-the-results)
- [Writing up findings](#writing-up-findings)
- [How it works](#how-it-works)
- [Limitations](#limitations)

## Quick start

From the repo root:

```fish
cd tools/fair-queueing-sim
npm install
npm run sim -- compare scenarios/stories/*.yml
open output/comparison.html
```

That runs every story scenario under every policy (a few minutes) and writes a side by side
comparison to `output/comparison.html` (with charts) and `output/comparison.md`.

Note the `--` after `npm run sim`: everything after it is passed to the simulator.

## Setup

The simulator lives in `tools/` rather than `services/` so that Lerna doesn't treat it as one of
Harmony's deployable packages, so its dependencies are installed separately:

```fish
npm install                       # at the repo root, as usual for Harmony
cd tools/fair-queueing-sim
npm install
```

It loads Harmony's code (and Harmony's dependencies) straight from `services/`, so it always runs
whatever is checked out in your working tree.

**sqlite driver.** The simulator uses Harmony's sqlite3 driver (`services/harmony/node_modules`),
falling back to its own copy if Harmony's was built for a different platform - e.g. in a dev
container that shares `node_modules` with a macOS host. If neither will load, the error says so;
run `npm rebuild sqlite3` in `tools/fair-queueing-sim` (if npm says sqlite3's install script isn't
approved, run `npm approve-scripts sqlite3` first).

You can ignore `EBADENGINE` warnings about the Node version.

## Running simulations

There are four commands:

```fish
npm run sim -- run <scenario.yml> [options]                     # one scenario, one policy
npm run sim -- compare <scenario.yml> [<scenario.yml> ...] [options]   # every scenario x every policy
npm run sim -- findings <scenario.yml> [<scenario.yml> ...] [options]  # a comparison plus the evidence behind it - see Writing up findings
npm run sim -- policies                                          # list the available policies
```

### `run`

Simulates one scenario under one policy and writes a report and raw data to
`output/<scenario name>/<policy>/`.

```fish
npm run sim -- run scenarios/stories/06-slow-vs-fast.yml
npm run sim -- run scenarios/stories/06-slow-vs-fast.yml --policy fast-lane-reserve
```

The policy is, in order of precedence: `--policy`, the scenario's `policy:` field, `baseline`.
The special policy `native` installs no policy at all and runs whatever scheduling code the
checked out Harmony has built in - that's how the simulator is checked against branches that
don't have the policy seam (see [Writing up findings](#writing-up-findings)).

### `compare`

Runs every given scenario under every policy (or just those in `--policies`), each run in its own
process and several at once, then writes `comparison.md` and `comparison.html` to `output/`.
Each run's own output still goes to `output/<scenario>/<policy>/`.

```fish
npm run sim -- compare scenarios/stories/*.yml
npm run sim -- compare scenarios/stories/04-crowded.yml scenarios/mixed-workload.yml --policies baseline,fast-lane-reserve
```

`compare` overwrites previous results in the same output directory, so use `--out` to keep runs
apart (e.g. one directory per seed or per setting you're trying).

### Options

| Option | Applies to | Meaning |
|---|---|---|
| `--policy <name>` | `run` | the policy to simulate |
| `--policies <a,b,...>` | `compare`, `findings` | the policies to compare (default: all of them) |
| `--seeds <n,n,...>` | `findings` | also run the comparison with each of these seeds, to show which differences hold up |
| `--references <REF=POLICY,...>` | `findings` | check that POLICY makes exactly the same decisions as git ref REF's own code - see [Writing up findings](#writing-up-findings) |
| `--out <dir>` | both | output directory (`run`: the run's own directory; `compare`: the root for all runs and the comparison) |
| `--seed <n>` | both | use this seed instead of the scenario's own - see [noise](#is-a-difference-real-or-noise) |
| `--set KEY=VALUE` | both | set an environment variable for Harmony, the work-scheduler, the work-updater and the policies; may be repeated; overrides the scenario's `env:` |
| `--parallel <n>` | `compare`, `findings` | how many simulations to run at once (default: CPU count - 1) |
| `--log-level <level>` | `run` | level for Harmony's own log, written to `harmony.log` (default `warn`) |
| `--quiet` | `run` | no progress output |

Examples:

```fish
# Harmony's current SQS long polling default instead of the 3s the scenarios use
npm run sim -- compare scenarios/stories/*.yml --set QUEUE_LONG_POLLING_WAIT_TIME_SEC=20 --out output/long-poll-20

# a different slow work threshold for the fast lane policies
npm run sim -- run scenarios/stories/06-slow-vs-fast.yml --policy fast-lane-reserve --set SLOW_WORK_THRESHOLD_MS=300000

# the same comparison with three different seeds
for seed in 1 2 3
    npm run sim -- compare scenarios/stories/*.yml --seed $seed --out output/seed-$seed
end
```

Any of Harmony's environment variables can be set this way, e.g. the scheduler's
`SERVICE_QUEUE_BATCH_SIZE_COEFFICIENT`, `WORK_ITEM_SCHEDULER_BATCH_SIZE` and
`MAX_WORK_ITEMS_ON_UPDATE_QUEUE`, or `WORK_ITEM_RETRY_LIMIT`. The simulator never reads your `.env`.

## Scenarios

A scenario is a YAML file describing the simulated cluster (services and their pod counts, plus
how quickly the Harmony components around the scheduler react) and the workload (jobs submitted
by users, each a chain of service steps with a duration distribution for their work items).

### Included scenarios

| File | What it shows |
|---|---|
| `scenarios/smoke.yml` | a tiny end to end check (a second of wall time) |
| `scenarios/stories/01-alone.yml` | one user alone gets the whole service |
| `scenarios/stories/02-small-sync.yml` | a small sync request arrives during another user's big async job |
| `scenarios/stories/03-sync-behind-own-async.yml` | a sync request competes with the same user's big async job |
| `scenarios/stories/04-crowded.yml` | eight users, with very different work item durations, compete for one service |
| `scenarios/stories/05-newcomer.yml` | a new user arrives while the service is crowded |
| `scenarios/stories/06-slow-vs-fast.yml` | slow (30 minute) work items compete with fast (1 minute) ones |
| `scenarios/stories/07-slow-alone.yml` | a user with only slow work has the service to themselves |
| `scenarios/stories/08-many-jobs.yml` | one user with four jobs vs one user with one job |
| `scenarios/stories/09-slowdown-drift.yml` | a job whose work items suddenly get 20x slower part way through |
| `scenarios/mixed-workload.yml` | six hours of random arrivals from five users across a two step chain (takes several minutes) |

To make your own, copy one and edit it.

### Format

```yaml
name: slow-vs-fast              # used for the output directory
description: Free text shown in the reports - what the scenario tests.
goodOutcome: >-                 # what a good result looks like, shown in the reports to guide interpretation
  Fast work keeps flowing while slow work runs; slow work never holds more than 70% of the pods.
seed: 6                         # every random draw derives from this (default 1)
maxDuration: 2d                 # stop here even if jobs are still running (default 7d)
policy: baseline                # default policy for `run` (optional)

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
  sampleInterval: 30s           # how often the system state is sampled for the charts/metrics

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

## Policies

A **fair queueing policy** decides which jobs get work items, and how many, each time the
work-scheduler fills a service's queue. Everything else - fetching the work items, marking them
queued, keeping `user_work` counts right, sending them to the queue - is shared code, so policies
can't get the bookkeeping wrong and can be swapped freely.

### How a policy is called

Harmony calls the active policy through the seam in
`services/harmony/app/backends/workflow-orchestration/fair-queueing-policy.ts`:

```ts
export interface FairQueueingPolicy {
  name: string;
  scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void>;
  onWorkItemCompleted?(tx, workItem): Promise<void>;
}
```

- **`scheduleWork`** is called once per scheduling batch (from `getWorkItemsFromDatabase`, inside
  its database transaction). `batchSize` is the most work items to hand out in total;
  `context.servicePodCount` is the number of pods running the service and `context.logger` a
  logger. The policy picks jobs and calls **`takeWorkItems(jobID, maxItems)`** for each, in
  priority order; it returns how many work items it actually got (possibly fewer, if the job
  ran out), so the policy can redistribute what's left.
- **`onWorkItemCompleted`** (optional) is called in the work item update transaction whenever a
  work item reaches a completed state (successful, failed after retries, canceled or warning),
  with the job and service IDs, the status and durations. Policies use it to keep their own state,
  such as measured work item durations.

Deployed Harmony always uses `baselinePolicy`. The simulator swaps in the policy you ask for with
`setFairQueueingPolicy`.

### Available policies

| Policy | What it does |
|---|---|
| `baseline` | Harmony's current algorithm (`baselinePolicy` in `fair-queueing-policy.ts`). Picks up to `batchSize` jobs interleaved round robin by user, oldest-worked first; shuffles them; splits the batch evenly per job. No knowledge of work item durations. |
| `fast-lane-reserve` | The algorithm from the `harmony-2413` branch (`src/policies/fast-lane-reserve.ts`, a faithful port - it produces byte-for-byte the same decision log as that branch's own code). Users are ranked within each round by the expected runtime of their in-progress work (running items x the job's mean work item duration), a user's sync jobs go before their async ones, and work for a (job, service) whose mean duration is above `SLOW_WORK_THRESHOLD_MS` may only occupy `1 - FAST_LANE_RESERVE_FRACTION` of the service's pods, reserving the rest for fast work. |
| `adaptive-fast-lane` | `fast-lane-reserve`, with the same reserve, plus five fixes (`src/policies/adaptive-fast-lane.ts`): (1) a (job, service) with no completed work item yet may only have a few work items running, so slow work can't fill the service before it's been measured; (2) durations are a moving average weighted towards recent work items, so a job that slows down is reclassified quickly; (3) when ranking users, unmeasured work counts as the service's current mean duration instead of a flat hour; (4) each batch is split evenly between users first, then between each user's jobs; (5) durations are the ones service pods report, so they don't include time spent waiting on the queue. Each fix has a switch (below); with all of them off it makes exactly the same decisions as `fast-lane-reserve`. |

Run `npm run sim -- policies` for the current list.

### Design intent: the fast lane reserve leaves pods idle on purpose

Both fast lane policies keep `FAST_LANE_RESERVE_FRACTION` of each service's pods away from slow
work **even when nothing else is waiting**. This is deliberate: Harmony has seen slow jobs take
every pod of a service and leave newly arriving fast jobs unworked, and the reserve guarantees
that can't happen. So when only slow work exists (story 07, and the end of stories 06 and 09),
"idle while work ready" goes up and slow jobs take longer - that's the cost of the guarantee, not
a bug, and policy changes shouldn't "fix" it by letting slow work use the reserve. The policies'
design notes say this in every report.

### Policy settings

Policies read their settings from environment variables, so set them in a scenario's `env:` or
with `--set`:

| Variable | Default | Used by | Meaning |
|---|---|---|---|
| `SLOW_WORK_THRESHOLD_MS` | `600000` (10 min) | both fast lane policies | a (job, service) whose mean work item duration is above this is "slow" |
| `FAST_LANE_RESERVE_FRACTION` | `0.3` | both fast lane policies | fraction of a service's pods slow work may not use |
| `ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT` | `2` | `adaptive-fast-lane` | fix 1: most work items that may run for a (job, service) before its first work item completes; `0` = no limit |
| `ADAPTIVE_FAST_LANE_EWMA_ALPHA` | `0.2` | `adaptive-fast-lane` | fix 2: weight of the newest work item in the moving average (higher reacts faster, but also to noise); `0` = mean over the job's lifetime |
| `ADAPTIVE_FAST_LANE_UNMEASURED_ESTIMATE` | `service` | `adaptive-fast-lane` | fix 3: `service` = unmeasured work counts as the service's mean measured duration over other jobs; `fixed` = it counts as `ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS` |
| `ADAPTIVE_FAST_LANE_UNMEASURED_DEFAULT_MS` | `3600000` (1 h) | `adaptive-fast-lane` | fix 3: expected duration of unmeasured work when the service has no measured work to go on |
| `ADAPTIVE_FAST_LANE_SPLIT_BY_USER` | `true` | `adaptive-fast-lane` | fix 4: `false` = split each batch evenly per job, not per user |
| `ADAPTIVE_FAST_LANE_USE_SERVICE_DURATION` | `true` | `adaptive-fast-lane` | fix 5: `false` = use Harmony's duration (measured from when the item was queued) |

Note that `--set` applies to every policy in a `compare`, so to compare two settings of the same
policy, run `compare` (or `run`) twice with different `--out` directories. For example, to see what
one of `adaptive-fast-lane`'s fixes contributes, compare runs with it on and off:

```fish
npm run sim -- compare scenarios/stories/*.yml --policies adaptive-fast-lane --out output/adaptive
npm run sim -- compare scenarios/stories/*.yml --policies adaptive-fast-lane --out output/adaptive-no-limit --set ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT=0
```

### Creating a policy

1. **Write it.** Add a file to `src/policies/`, e.g. `src/policies/my-policy.ts`:

   ```ts
   import type { FairQueueingPolicy } from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
   import UserWork from '../../../../services/harmony/app/models/user-work';

   export const myPolicy: FairQueueingPolicy = {
     name: 'my-policy',

     async scheduleWork(tx, serviceID, batchSize, context, takeWorkItems): Promise<void> {
       // e.g. the jobs with ready work for this service, least recently worked first
       const rows = await tx(UserWork.table)
         .select('job_id', 'username')
         .where({ service_id: serviceID })
         .where('ready_count', '>', 0)
         .orderBy('last_worked', 'asc');
       let remaining = batchSize;
       for (const row of rows) {
         if (remaining <= 0) break;
         remaining -= await takeWorkItems(row.job_id, Math.min(remaining, 5));
       }
     },

     // optional
     async onWorkItemCompleted(tx, workItem): Promise<void> {
       // workItem: { jobID, serviceID, workItemID, status, durationMs, serviceDurationMs }
     },
   };
   ```

   `tx` is a knex transaction on Harmony's database; the tables are in `db/db.sql`. A policy
   that wants randomness should use `Math.random`, which the simulator seeds so runs stay
   reproducible.

2. **Register it.** Add it to the map in `loadPolicies` in `src/policies/index.ts`, and describe
   it in `POLICY_CATALOG` in `src/policies/catalog.ts` (which the CLI and reports read without
   loading Harmony):

   ```ts
   'my-policy': {
     description: 'One or two sentences on what the policy does - shown in every report.',
     designNotes: ['Anything a reader must know to interpret its results, e.g. deliberate trade-offs.'],
     settings: [
       { env: 'MY_POLICY_LIMIT', default: '5', description: 'what the setting does' },
     ],
     // optional, for findings.md: one variant per feature, with that feature switched off
     variants: [
       { name: 'no-limit', description: 'the limit off', set: { MY_POLICY_LIMIT: '0' } },
     ],
     // optional, for findings.md: settings under which it must behave exactly like another policy
     equivalentTo: { policy: 'baseline', set: { MY_POLICY_LIMIT: '0' }, description: 'with no limit it is baseline' },
   },
   ```

   Optionally give it a sampler in `loadPolicies` too - a function returning numbers to record in
   every sample (e.g. how much slow work is running); they appear as extra rows in the reports.
   See `sampleFastLaneReserve` in `fast-lane-reserve.ts` for an example.

3. **Settings.** Read them from `process.env` when the policy runs (as `fast-lane-reserve` does),
   with the same defaults as in the catalog, and add them to the table above. The catalog's list
   is what gets recorded as the run's policy settings, so keep it complete.

4. **Schema changes.** If the policy needs new columns or tables, add a real migration to
   `db/migrations/` and the same change to `db/db.sql` (the simulator builds its database from
   `db.sql`), so the migration you'll eventually ship is the one you tested.

5. **Try it.** `npm run sim -- compare scenarios/stories/*.yml --policies baseline,my-policy`

6. **Check it.** If your policy is meant to behave exactly like another one under some settings
   (e.g. a variant with a feature switched off), declare it with `equivalentTo` and run
   `findings`, which checks the decision logs are identical - see
   [Writing up findings](#writing-up-findings).

Moving a policy into Harmony for real means moving its file next to `fair-queueing-policy.ts`,
making it the default (or selectable) there, and testing it like any other production change.

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

Times are milliseconds since the start of the simulation. The `.ndjson` files have one JSON object
per line, which is easy to explore with `jq`:

```fish
# the scheduling decisions in the second hour
jq -c 'select(.t >= 3600000 and .t < 7200000)' output/04-crowded/baseline/decisions.ndjson

# pods per user every ~10 minutes
jq -c 'select(.t % 600000 < 30000) | {min: (.t / 60000 | floor), busy: .services[0].busyByUser}' output/06-slow-vs-fast/fast-lane-reserve/samples.ndjson
```

`compare` also writes `comparison.md` and `comparison.html` to its output directory.

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
- **Overall** table - one row per metric, one column per policy.
- **Users** table - each user's fair share ratio and mean job slowdown, per policy.
- **Jobs** table - each job's makespan and slowdown, per policy (for scenarios with up to 30 jobs).

`comparison.md` has the same tables without the charts. Each run's `report.md` has more detail
(e.g. wait times per job).

### The metrics

| Metric | Meaning | Good value |
|---|---|---|
| **makespan** | time from a job's submission to its completion | lower |
| **slowdown** | makespan divided by a lower bound on how long the job would take with the cluster to itself (for each step, the longer of its longest work item and its total work spread perfectly over the service's pods) | 1.0 is as fast as possible; 2.0 means it took twice as long as it could have |
| **wait** (mean / p95, in `report.md`) | time from a work item being ready to a pod starting it | lower |
| **sync makespan** | makespan of synchronous requests - what an interactive user waits for | lower |
| **fair share** (per user) | while the user was competing with at least one other user for a service: the pods running their work divided by their *max-min fair share* of the pods. The fair share is an equal split of the pods, except that users who want fewer than that get what they want and the rest is split among the others | 1.00 is exactly fair; below 1 the user was short-changed; above 1 they got more than their share |
| **contended fairness** (per service) | Jain's fairness index of those per-user ratios, averaged over the samples where two or more users wanted the service | 1.0 means every competing user had exactly their share |
| **utilization** | pod time spent running work divided by pods x simulated time | higher, but it also drops simply because the service runs out of work near the end |
| **idle while work ready** | pod-hours spent idle while the service had work ready or queued | ~0 for policies without a reserve; anything substantial there means pods are being left unused. For the fast lane policies, idle time while only slow work is waiting is the reserve doing its job (see [design intent](#design-intent-the-fast-lane-reserve-leaves-pods-idle-on-purpose)) |
| **policy rows** (e.g. `slowRunning`, `fastLaneOnly`) | values the policy's sampler recorded: maximum and time-weighted mean | depends on the policy - e.g. `slowRunning` above `slowCapacity` means slow work got past the cap, and `fastLaneOnly` 0.5 means slow work was capped half the time |

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
- **Judge against the scenario's goal.** Each scenario says what a good result looks like; a
  policy that "wins" on a metric the scenario doesn't care about hasn't necessarily done better.
- **Find out why.** When a result is surprising, look at that run's `samples.ndjson` around the
  time it happened (who had pods, who had work ready), then `decisions.ndjson` (what the policy
  chose).

### Is a difference real, or noise?

Runs are deterministic: the same scenario, policy and seed always produce identical output, and
work item durations are drawn per work item, so they're the same under every policy. But the
order in which the scheduler happens to pick jobs still differs between policies, so small
differences - a few percent, or a few seconds on a short job - can be noise. Before relying on a
difference, re-run with a few seeds and check it holds up - `findings --seeds` does this and
summarizes how often each policy came out best:

```fish
npm run sim -- findings scenarios/stories/*.yml --seeds 101,102,103
```

or by hand:

```fish
for seed in 1 2 3 4 5
    npm run sim -- compare scenarios/stories/02-small-sync.yml --seed $seed --out output/seed-$seed
end
```

### Getting Claude Code to interpret the results

Claude Code can read every output file, so it can do this analysis for you. The reports carry
what it needs to interpret them correctly - each scenario's goal, the policies' design notes, the
metric definitions and the provenance - and this README has the rest, so point it at a report and
ask for what you want to know, for example:

- *"Read tools/fair-queueing-sim/output/findings/findings.md and write its Conclusions section."*
- *"Read tools/fair-queueing-sim/output/comparison.md and summarize, scenario by scenario, which
  policy did better and why. Explain the metrics in plain terms."*
- *"In story 06, why do gina and hank finish at about the same time under both policies? Use
  the samples.ndjson files in tools/fair-queueing-sim/output/06-slow-vs-fast/ to show how many
  pods each user had over time."*
- *"Compare the decisions.ndjson files for 04-crowded under baseline and fast-lane-reserve and
  explain the first pass where they choose differently."*
- *"Run the story scenarios with seeds 1 to 5 and tell me which differences between the policies
  are consistent and which are noise."*
- *"I want a policy that does X. Write it in tools/fair-queueing-sim/src/policies, register it,
  compare it with the existing policies on the story scenarios, and explain the results."*

It helps to say which scenario and policies you care about, and what you consider "better" (e.g.
fastest sync requests, nobody starved, best average turnaround).

### Checking that a change doesn't alter behavior

Because runs are deterministic, the decision log works as a regression check for refactoring
Harmony's scheduling code or porting a policy. Run the same scenarios before and after the change,
into different output directories, and compare `decisions.ndjson`, `runs.ndjson` and
`work-items.ndjson` - they should be identical:

```fish
npm run sim -- compare scenarios/stories/*.yml --policies baseline --out /tmp/before
# ... make the change ...
npm run sim -- compare scenarios/stories/*.yml --policies baseline --out /tmp/after
for d in /tmp/before/*/baseline
    set s (basename (dirname $d))
    cmp -s $d/decisions.ndjson /tmp/after/$s/baseline/decisions.ndjson; and echo "$s same"; or echo "$s DIFFERENT"
end
```

To check a policy against another branch's *own* code (e.g. a port), use `findings --references`
(below), which does the equivalent of this against a checkout of that branch.

## Writing up findings

When a comparison is worth sharing or acting on, `findings` produces a write-up with the evidence
behind it:

```fish
npm run sim -- findings scenarios/stories/*.yml --seeds 101,102,103 \
    --references 'harmony-2413=fast-lane-reserve,main=baseline@services/harmony/app/models/user-work.ts'
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
     exactly the same decisions as the other policy under the stated settings (e.g.
     `adaptive-fast-lane` with all five fixes off = `fast-lane-reserve`);
   - **references** (`--references REF=POLICY`) - that POLICY here makes exactly the same decisions
     as the scheduling code built into git ref REF. The simulator extracts REF's code into a
     temporary directory and runs it with the `native` policy. `@file;file` copies those files
     from your checkout over REF's first, for code REF can't run under the simulator - `main`
     before this branch can't run its scheduling SQL on sqlite, hence the `user-work.ts` overlay
     above (it only adds the sqlite-compatible lock clause). Once that's on `main`, the overlay
     isn't needed.

and then writes `output/findings/findings.md` with: what produced it (command, commit,
uncommitted changes), the policies and their design notes, each scenario's goal, the
**Conclusions**, the results, robustness across seeds (mean, range and how often each policy was
best, per metric), what each feature contributes, and the validation results.

**Conclusions** are the one part a person (or Claude Code) writes - ask Claude Code to *"read
tools/fair-queueing-sim/output/findings/findings.md and write its Conclusions section"*.
Everything else is regenerated each time `findings` runs, but the Conclusions are kept. They're
stamped (in a comment) with the code they were written for; if `findings` is rerun on different
code, it flags them for review at the top of the section. After reviewing, update the stamp as the
flag says.

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
command, `src/provenance.ts` records what produced each run, and `src/policies/` has the policies
(`catalog.ts` describes them; `index.ts` loads them).

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
