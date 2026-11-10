# Fair queueing simulator

Simulates Harmony's fair queueing much faster than real time, so fair queueing policies can be
developed and compared on exactly the same workloads. It runs Harmony's **real** scheduling and
work item update code against a real (sqlite) database, with simulated service pods and a virtual
clock, so hours of activity simulate in seconds.

It comes with Harmony's three policies, which the work-scheduler's `FAIR_QUEUEING_POLICY` selects
between: `slot-based`, the default, which every production service runs today; `duration-based`
(the fast lane), which isn't used in production; and `fair-share-fast-lane`, built on
`duration-based`. It also has `slot-based-fair-share`, `slot-based` plus a fair share rule and
sync requests first, a smaller candidate that needs no work item durations. Policies added to
`src/policies/` are for simulation only until they're [promoted](#6-promote-it-to-production).

**`fair-share-fast-lane` (called `adaptive-fast-lane` until 2026-11-10) has been chosen to replace
`slot-based`**, and is in Harmony
(`FAIR_QUEUEING_POLICY=fair-share-fast-lane`; the default is still `slot-based`).
[RESULTS.md](RESULTS.md) records the improvement over the current policy and how to reproduce it;
[POLICY-DESIGN.md](POLICY-DESIGN.md) explains the design.

- [Setup](#setup)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Developing a policy](#developing-a-policy)
- [Scenarios and policies](#scenarios-and-policies)

[REFERENCE.md](REFERENCE.md) has the details: the scenario format, the policy interface and
settings, the metrics and how to interpret them, the output files, how benchmark records work,
how the simulator works, and its limitations.

## Setup

From the repo root (the simulator is in `tools/`, outside Lerna, so it has its own install):

```
npm install
cd tools/fair-queueing-sim
npm install
```

It runs Harmony's code from `services/` in your working tree. If the sqlite3 driver won't load
(e.g. in a dev container that shares `node_modules` with a macOS host), run `npm rebuild sqlite3`
here, after `npm approve-scripts sqlite3` if npm asks. `EBADENGINE` warnings about the Node version
can be ignored. `npm run better-audit` checks the simulator's dependencies the way Harmony's own
services do, with accepted advisories in `.nsprc`.

`npm test` lints the simulator, runs its tests (mocha and chai, as in Harmony's services) and
audits its dependencies; `npm run test-fast` runs just the tests, without type checking. The
tests in `test/` cover scenario parsing, the random streams, the metrics, the code hash and the
policy catalog, plus a smoke test that runs `scenarios/smoke.yml` end to end under every policy
and checks it's deterministic. They don't run in CI.

## Quick start

From `tools/fair-queueing-sim`:

```
# compare a policy with the baseline, slot-based, on the benchmark suite (a few minutes)
npm run sim -- bench --policies duration-based

# every story under every policy, with charts of who had which pods
npm run sim -- compare scenarios/stories/*.yml
open output/comparison.html
```

The `--` after `npm run sim` passes everything after it to the simulator.

## Commands

| Command | What it does | Output |
|---|---|---|
| `run <scenario.yml>` | one scenario under one policy (`--policy`, else the scenario's, else `slot-based`) | `output/<scenario>/<policy>/` |
| `compare <scenario.yml> ...` | every scenario under every policy (or `--policies`) | `output/comparison.html` (with charts), `comparison.md` |
| `bench [<scenario.yml> ...]` | the benchmark suite (or the given scenarios) for the given policies, compared with `slot-based`'s recorded results and their own | `output/bench/bench.md` |
| `findings <scenario.yml> ...` | a comparison plus the evidence behind conclusions about it: other seeds, each feature switched off in turn, validation checks | `output/findings/findings.md` |
| `policies` | list the policies | |

| Option | Applies to | Meaning |
|---|---|---|
| `--policy <name>` | `run` | the policy to simulate |
| `--policies <a,b,...>` | `compare`, `findings`, `bench` | the policies to run (default: all of them; `bench`: the suite's) |
| `--seed <n>` | `run`, `compare` | use this seed instead of the scenario's own |
| `--seeds <n,n,...>` | `bench`, `findings` | `bench`: use these seeds instead of the suite's; `findings`: also run with each of these seeds |
| `--set KEY=VALUE` | all | set an environment variable for Harmony, the scheduler, the updater and the policies (repeatable; overrides the scenario's `env:`) |
| `--record` | `bench` | save the results to `benchmarks/results/<policy>.json` |
| `--label <name>` | `bench` | also save the results to `output/experiments/<date>-<name>/` (not committed) |
| `--suite <file>` | `bench` | the benchmark suite (default `benchmarks/suite.yml`) |
| `--references <REF=POLICY,...>` | `findings` | check POLICY makes exactly the same decisions as git ref REF's own code (see [REFERENCE.md](REFERENCE.md#writing-up-findings)) |
| `--out <dir>` | all | output directory |
| `--parallel <n>` | `compare`, `bench`, `findings` | simulations to run at once (default: CPU count - 1) |
| `--log-level <level>` | `run` | level for Harmony's log, `harmony.log` (default `warn`) |
| `--quiet` | `run` | no progress output |

Any of Harmony's environment variables can be set with `--set`, e.g.
`--set QUEUE_LONG_POLLING_WAIT_TIME_SEC=20` or `--set WORK_ITEM_SCHEDULER_BATCH_SIZE=10`. The
simulator never reads your `.env`. `compare` overwrites earlier results in its output directory,
so use `--out` to keep runs apart.

## Developing a policy

### 1. Write it

Add a file to `src/policies/`, named after the policy (benchmark records rely on the name), e.g.
`src/policies/my-policy.ts`:

```ts
import type {
  FairQueueingPolicy, SchedulingContext, TakeWorkItems,
} from '../../../../services/harmony/app/backends/workflow-orchestration/fair-queueing-policy';
import UserWork from '../../../../services/harmony/app/models/user-work';
import type { Transaction } from '../../../../services/harmony/app/util/db';

export const myPolicy: FairQueueingPolicy = {
  name: 'my-policy',

  // called once per scheduling batch: pick jobs and call takeWorkItems for each, in priority
  // order; it returns how many work items it actually got
  async scheduleWork(
    tx: Transaction,
    serviceID: string,
    batchSize: number,
    context: SchedulingContext,
    takeWorkItems: TakeWorkItems,
  ): Promise<void> {
    const rows: { job_id: string; username: string }[] = await tx(UserWork.table)
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
};
```

`tx` is a knex transaction on Harmony's database (tables in `db/db.sql`): Postgres in production,
sqlite in the simulator and in Harmony's tests. Write queries that work on both - knex's query
builder, as above, produces the right SQL for either - and where raw SQL has to differ, branch the
way Harmony's own scheduling code does (see [REFERENCE.md](REFERENCE.md#postgres-and-sqlite)).
`context` has the service's pod count and the work-scheduler's fast lane settings. For randomness
use `Math.random`, which the simulator seeds. The full interface is in
[REFERENCE.md](REFERENCE.md#the-policy-interface).

### 2. Register it

Add it to `loadPolicies` in `src/policies/index.ts`, and describe it in `POLICY_CATALOG` in
`src/policies/catalog.ts`:

```ts
'my-policy': {
  description: 'One or two sentences on what the policy does - shown in every report.',
  designNotes: ['Anything a reader must know to interpret its results, e.g. deliberate trade-offs.'],
  settings: [
    { env: 'MY_POLICY_LIMIT', default: '5', description: 'what the setting does' },
  ],
  // optional, for findings: one variant per feature with that feature switched off, and
  // settings under which it must make exactly the same decisions as another policy
  variants: [{ name: 'no-limit', description: 'the limit off', set: { MY_POLICY_LIMIT: '0' } }],
  equivalentTo: { policy: 'slot-based', set: { MY_POLICY_LIMIT: '0' }, description: 'with no limit it is slot-based' },
},
```

- **Settings**: read them from `process.env` when the policy runs, with the same defaults as the
  catalog. The catalog's list is what gets recorded as a run's settings, so keep it complete.
- **Schema changes**: add a real migration to `db/migrations/` and the same change to
  `db/db.sql` (the simulator builds its database from `db.sql`), so the migration you ship is the
  one you tested. While experimenting, a `loadPolicies` entry's optional `setup` can make the
  change instead, in the simulator's database only.
- **Learning from completed work items**: the policy interface only covers scheduling. A
  `loadPolicies` entry's optional `onWorkItemCompleted` is called, in the simulator only, in the
  work-updater's transaction whenever a work item finishes. `fair-share-fast-lane` uses it to keep
  its own duration estimates for fixes 2 and 5, which is why those fixes are simulator only. A
  policy that needs it can't ship until the hook exists in Harmony - see
  [step 6](#6-promote-it-to-production).
- **Sampling**: an optional `sampler` records policy specific state over time (e.g. how many
  slow work items are running) for the run's report.

### 3. Iterate against the baseline

```
# while iterating: a couple of scenarios, one seed (seconds)
npm run sim -- bench scenarios/stories/02-small-sync.yml scenarios/stories/06-slow-vs-fast.yml --policies my-policy --seeds 101

# the whole suite (a few minutes) - the baseline, slot-based, isn't rerun
npm run sim -- bench --policies my-policy

# trying a setting
npm run sim -- bench --policies my-policy --set MY_POLICY_LIMIT=4

# keeping a version you might want to come back to (in output/experiments/, not committed)
npm run sim -- bench --policies my-policy --label limit-4
```

Labeled results stay on your machine. If an experiment is worth keeping, write it up in the PR or
Jira ticket with the command that reproduces it.

`bench` prints a table of every scenario's **protected metrics**: the metrics that say whether
the scenario's goal was met, e.g. the sync request's makespan in 02-small-sync. It writes the full
report, with every metric, to `output/bench/bench.md`. Values are the mean over the seeds, with
the range in brackets.

- **vs slot-based** compares with the baseline, `slot-based`, seed by seed. Runs with the same
  seed have the same work item durations, so **better (or worse) in 5/5 seeds** is a real
  difference and a mixed count is noise.
- **vs &lt;policy&gt;** compares, the same way, with each policy listed before it in `--policies`
  (or the suite's `policies`), e.g. `fair-share-fast-lane` with `duration-based`, the policy it
  improves on.
- **vs recorded** compares with the policy's own recorded results: what your changes since then
  did.

`slot-based`'s results come from `benchmarks/results/slot-based.json`. They're only rerun when
something that could change them has changed, and the report says why. See
[REFERENCE.md](REFERENCE.md#when-baseline-is-rerun).

### 4. Find out why

When a result is surprising, `compare` shows it over time: its charts show how many pods each user
had. Run `npm run sim -- compare <scenario.yml> --policies slot-based,my-policy` and open
`output/comparison.html`. Each run's `samples.ndjson` (who had pods and who had work ready) and
`decisions.ndjson` (what the policy chose, batch by batch) have the detail.

Claude Code can do this analysis. Point it at a report and say what you care about, e.g. *"Read
tools/fair-queueing-sim/output/bench/bench.md and explain where my-policy is worse than slot-based
and why"*. [REFERENCE.md](REFERENCE.md#interpreting-the-results) explains the reports and metrics.

### 5. Record it once it's a candidate

Add the policy to `policies:` in `benchmarks/suite.yml`, then:

```
npm run sim -- bench --record --policies my-policy
```

Commit `benchmarks/results/my-policy.json` with the code that produced it. Its diffs then show
exactly which metrics each change moved. `--record` always runs the whole suite with its own seeds
and settings.

If the policy declares `variants` or `equivalentTo`, `npm run sim -- findings
scenarios/stories/*.yml --seeds 101,102,103` checks them and writes up the evidence (see
[REFERENCE.md](REFERENCE.md#writing-up-findings)).

### 6. Promote it to production

In production the work-scheduler picks the policy in `processSchedulerQueue`
(`services/work-scheduler/app/workers/scheduler.ts`) from `FAIR_QUEUEING_POLICY`
(`getFairQueueingPolicy` in `fair-queueing-policy.ts`), and passes it to
`getWorkItemsFromDatabase` along with the service's pod count and the fast lane settings. The
simulator replaces that choice with the policy being simulated. `fair-share-fast-lane` was promoted
this way. To ship a policy:

1. **Move it into Harmony**, next to
   `services/harmony/app/backends/workflow-orchestration/fair-queueing-policy.ts` (as
   `fair-share-fast-lane-policy.ts` is), and fix its imports. Import it from there in
   `src/policies/`, so the simulator benchmarks the code that ships, not a copy. Anything only the
   simulator can provide - `setup`, `onWorkItemCompleted`, a sampler - stays in `src/policies/`.
2. **Make it selectable, defaulting to the current policy.** Add it to `FAIR_QUEUEING_POLICIES` in
   `fair-queueing-policy.ts` and its name to the values `FAIR_QUEUEING_POLICY` accepts
   (`services/work-scheduler/app/util/env.ts`), and add its own settings to
   `services/work-scheduler/env-defaults`, which the work-scheduler loads into `process.env`.
   Take the catalog's defaults from there with `workSchedulerDefault`, as `fair-share-fast-lane`'s
   are. Switching back is then a configuration change, which is the rollback. **Keep the old
   policy selectable**, both for the rollback and so it can still be simulated: the simulator runs
   Harmony's own `slotBasedPolicy` as its baseline, `slot-based`, and the improvement in
   [RESULTS.md](RESULTS.md) is measured against it.
3. **Check what it needs and stores.** The interface only covers scheduling, so a policy with an
   `onWorkItemCompleted` hook (simulator only) needs that hook added to the work-updater, which
   means extending the interface - or, as with `fair-share-fast-lane`'s fixes 2 and 5, leaving what
   needs it out of production. Policies that share `user_work` columns misread each other's
   values after a switch: `duration-based` keeps a lifetime mean in `average_duration`, so a
   policy that wants, say, a moving average needs its own column, as `fair-share-fast-lane`'s
   `adaptive_duration` is, or a settling period after a switch. Replace any `setup` schema
   change with a migration in `db/migrations/` plus `db/db.sql`.
4. **Test it** like any production change: unit tests for the policy, and a test of its selection
   in `services/work-scheduler/test/scheduler.ts`.
5. **Re-record the benchmarks** with `npm run sim -- bench --record`. The policy is production code
   now, so the records' code hashes change. The numbers should be unchanged.
6. **Roll it out** with the default unchanged. Enable it in UAT, compare with production using the
   dashboard's work item duration metrics, then enable it in production. Production runs
   `slot-based` everywhere, so a policy built on `duration-based` is also the first time
   production runs duration-aware scheduling - its queries, its advisory lock and the fast lane
   reserve. Trying plain `duration-based` in UAT first separates "that machinery works" from "the
   policy helps". Rolling back means switching back to `slot-based`.

## Scenarios and policies

| Scenario | What it shows |
|---|---|
| `scenarios/smoke.yml` | a tiny end to end check (about a second) |
| `scenarios/stories/01-alone.yml` | one user alone gets the whole service |
| `scenarios/stories/02-small-sync.yml` | a small sync request arrives during another user's big async job |
| `scenarios/stories/03-sync-behind-own-async.yml` | a sync request competes with the same user's big async job |
| `scenarios/stories/04-crowded.yml` | eight users, with very different work item durations, compete for one service |
| `scenarios/stories/05-newcomer.yml` | a new user arrives while the service is crowded |
| `scenarios/stories/06-slow-vs-fast.yml` | slow (30 minute) work items compete with fast (1 minute) ones |
| `scenarios/stories/07-slow-alone.yml` | a user with only slow work has the service to themselves |
| `scenarios/stories/08-many-jobs.yml` | one user with four jobs vs one user with one job |
| `scenarios/stories/09-slowdown-drift.yml` | a job whose work items suddenly get 20x slower part way through |
| `scenarios/stories/10-multi-granule-sync.yml` | a stress case: a 4 granule sync request (production sync requests are 1 granule) |
| `scenarios/stories/11-new-slow-pair.yml` | two users start new slow jobs together, and fast work arrives five minutes later |
| `scenarios/stories/12-occasional-long-items.yml` | a job that's fast on average but has occasional long work items, alongside a slow job |
| `scenarios/mixed-workload.yml` | six hours of random arrivals from five users across a two step chain (several minutes) |
| `scenarios/production/hoss-saturated.yml` | hoss under a permanent backlog, built from the production dashboard's stats: 125 pods, 16 users, work items of seconds, a user whose work items average 8.5 minutes, sync requests and a one-at-a-time user (about 2 minutes a run) |
| `scenarios/production/geoloco-one-user.yml` | geoloco as production has it, one user keeping 125 pods busy with work items of about 2 minutes, then a newcomer, small jobs and sync requests |
| `scenarios/production/trajectory-burst.yml` | a trajectory-subsetter burst on 125 pods: 11 users from its stats, including users whose work items average minutes, with a heavy tail |
| `scenarios/production/slow-user-first.yml` | an idle 125 pod service, a user with 30-60 minute work items, then fast work and sync requests 5 minutes later - the case the fast lane reserve exists for |

The stories are the benchmark suite. [SCENARIOS.md](SCENARIOS.md) sets out what each one models, its
goal and how the policies do, for review. To make a scenario, copy one; the format is in
[REFERENCE.md](REFERENCE.md#scenario-format).

| Policy | What it does |
|---|---|
| `slot-based` | Harmony's default algorithm, and what every production service runs: jobs interleaved round robin by user, users with the fewest running work items for the service first, with each batch split evenly per job |
| `duration-based` | Harmony's algorithm when `FAIR_QUEUEING_POLICY` is `duration-based` (not set in production): users ranked by the expected runtime of their running work for the service, and a fast lane reserve |
| `slot-based-fair-share` | `slot-based`, plus two fixes that need no work item durations: while another user below their fair share of the pods has work ready, each user is held to theirs (so a user whose work items take minutes can't accumulate the service), and sync requests get each batch first and are never held back. No reserve, durations, schema change or work-updater hook |
| `fair-share-fast-lane` | **The candidate chosen for production**, Harmony's algorithm when `FAIR_QUEUEING_POLICY` is `fair-share-fast-lane` (not set in production yet). `duration-based`, with a 10% reserve instead of 30%, plus fixes for what the stories show it getting wrong: a limit on work for jobs with no measured duration yet, estimates for new jobs from the service's other jobs, batches split per user, every user held to a fair share of the pods while others wait, unmeasured work treated as slow (and still limited) once it has run past the threshold, and sync requests first, never held back by fair share. Two more fixes - a moving average of durations, and using the durations the service pods report - are off by default and simulator only: they'd need a work-updater hook and a migration. See [RESULTS.md](RESULTS.md) |

**The fast lane reserve leaves pods idle on purpose.** Slow work may never use more than
`1 - FAST_LANE_RESERVE_FRACTION` of a service's pods, even when nothing else is waiting, because
Harmony has seen slow jobs take every pod and leave arriving fast jobs unworked. Idle pods when
only slow work exists (story 07) are the cost of that guarantee, not a bug to fix.

Policy settings and fuller descriptions are in [REFERENCE.md](REFERENCE.md#policies), and the reasoning
and evidence behind `fair-share-fast-lane`'s design in [POLICY-DESIGN.md](POLICY-DESIGN.md).
